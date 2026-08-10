/**
 * Deletes organizations nobody can reach: zero memberships in `users.organizations[]`, zero guests
 * with a real account, and — for personal organizations — no user behind the email in `name`.
 *
 * The F2 dry run surfaced 5 of these, all personal spaces of test accounts (`hola5@gmail.com` x3,
 * `hola6@gmail.com`) whose user document no longer exists. They are not a security risk on their
 * own (nobody can enter an organization they hold no membership in), but they pollute every owner
 * report and every org count.
 *
 *   pnpm cleanup:orphan-orgs                # dry run — prints what it would delete, writes nothing
 *   pnpm cleanup:orphan-orgs -- --apply     # deletes
 *   pnpm cleanup:orphan-orgs -- --apply --force   # deletes even if other collections reference the org
 *
 * Deleting is the destructive direction, so the safe mode is the default here — the opposite of
 * `migrate-org-roles`, where the safe mode is a no-op backfill.
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { UserEntity } from '../src/user/user.entity';
import { OrganizationEntity, OrganizationDocument } from '../src/organization/schemas/organization.schema';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

type UserDoc = UserEntity & { _id: mongoose.Types.ObjectId };

interface Candidate {
  org: OrganizationDocument;
  orgId: string;
  references: { collection: string; count: number }[];
}

function log(...args: any[]) {
  console.log(...args);
}

/**
 * Counts documents pointing at the organization across every collection in the database. A document
 * left behind with a dangling `orgId` is invisible to the app but still in the tenant's data, so an
 * orphan with references is reported and skipped rather than deleted.
 */
async function countReferences(db: mongoose.mongo.Db, orgId: string): Promise<{ collection: string; count: number }[]> {
  const collections = await db.listCollections().toArray();
  const hits: { collection: string; count: number }[] = [];

  for (const { name } of collections) {
    if (name === 'organizations') {
      continue;
    }
    const count = await db.collection(name).countDocuments({ $or: [{ orgId }, { organizationId: orgId }, { 'auditable.orgId': orgId }] }, { limit: 100 });
    if (count > 0) {
      hits.push({ collection: name, count });
    }
  }

  return hits;
}

async function main() {
  log(`\n=== cleanup-orphan-orgs ${APPLY ? '(APPLYING — organizations will be deleted)' : '(DRY RUN — nothing will be deleted)'} ===\n`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const userModel: Model<UserEntity> = app.get(getModelToken(UserEntity.name));
    const orgModel: Model<OrganizationDocument> = app.get(getModelToken(OrganizationEntity.name));
    const db = orgModel.db.db;

    const users = (await userModel.find({}).exec()) as unknown as UserDoc[];
    const orgs = await orgModel.find({}).exec();
    log(`Loaded ${users.length} users and ${orgs.length} organizations.\n`);

    const emails = new Set(users.map(u => u.email?.toLowerCase()).filter(Boolean));
    const memberOrgIds = new Set<string>();
    for (const user of users) {
      for (const membership of user.organizations ?? []) {
        if (membership.orgId) {
          memberOrgIds.add(membership.orgId);
        }
      }
    }

    const candidates: Candidate[] = [];
    for (const org of orgs) {
      const orgId = org._id.toString();

      if (memberOrgIds.has(orgId)) {
        continue; // somebody holds a membership — not an orphan
      }
      const guests: any[] = Array.isArray(org.guests) ? org.guests : [];
      if (guests.some(guest => typeof guest?.email === 'string' && emails.has(guest.email.toLowerCase()))) {
        continue; // a real account still sits in guests[] — the F2 migration will turn it into a membership
      }
      if (org.type === 'personal' && typeof org.name === 'string' && emails.has(org.name.toLowerCase())) {
        continue; // personal space of a live account that simply has no membership row yet
      }

      candidates.push({ org, orgId, references: await countReferences(db, orgId) });
    }

    if (candidates.length === 0) {
      log('No orphan organizations found.\n');
      return;
    }

    log('--- ORPHAN ORGANIZATIONS ---');
    const deletable: Candidate[] = [];
    for (const candidate of candidates) {
      const { org, orgId, references } = candidate;
      log(`  • ${org.name} (${orgId}) type=${org.type ?? 'n/a'} guests=${Array.isArray(org.guests) ? org.guests.length : 0}`);
      if (references.length > 0) {
        log(`      referenced by: ${references.map(r => `${r.collection}=${r.count}`).join(', ')}`);
        if (!FORCE) {
          log('      SKIPPED — pass --force to delete it anyway');
          continue;
        }
      }
      deletable.push(candidate);
    }

    log('\n==================================================');
    log(APPLY ? 'DELETING' : 'DRY RUN SUMMARY (nothing deleted)');
    log('==================================================');
    log(`Orphans found:        ${candidates.length}`);
    log(`${APPLY ? 'Deleted' : 'Would delete'}:        ${deletable.length}`);
    log(`Skipped (referenced): ${candidates.length - deletable.length}`);

    if (APPLY) {
      for (const { org, orgId } of deletable) {
        await orgModel.deleteOne({ _id: org._id }).exec();
        log(`  - deleted ${org.name} (${orgId})`);
      }
    } else {
      log('\nRe-run with `-- --apply` to delete them.');
    }
    log('');
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
