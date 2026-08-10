/**
 * F2 — Backfills org-scoped membership data onto `users.organizations[]`.
 *
 * Idempotent: running it twice produces zero changes the second time. It never deletes
 * `organizations.guests[]` — that stays as a safety net until F16.
 *
 *   pnpm migrate:org-roles -- --dry-run     # prints the plan, writes nothing
 *   pnpm migrate:org-roles                  # applies it
 *
 *   --owner-fallback=<email>   Team organizations left without a resolvable owner get this user as
 *                              owner (membership created if missing). Personal organizations are
 *                              never covered by it — their owner is a specific person, not a
 *                              fallback. Decided by Adamo on 2026-08-09 for the 16 legacy team orgs
 *                              whose `auditable.createdBy` was never written.
 *
 * What it does, per the plan (06 §Fase 2):
 *   1. Every org without an owner → its `auditable.createdBy` gets `role: 'owner'`.
 *      Unresolvable → `--owner-fallback` if given, otherwise reported, never guessed.
 *   2. Every membership without a role → `member` / `active` / `joinedAt`.
 *   3. Every `guests[]` entry without a mirror membership → membership created.
 *   4. `guests[].name` → `displayName`, `guests[].image` → `avatar` (only when empty).
 *   5. `type: 'personal'` orgs → their owner gets `role: 'owner'`.
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { UserEntity } from '../src/user/user.entity';
import { OrganizationEntity, OrganizationDocument } from '../src/organization/schemas/organization.schema';
import { IUserOrganization, OrgRole } from '../src/user/user.class';

const DRY_RUN = process.argv.includes('--dry-run');
const OWNER_FALLBACK = (process.argv.find(arg => arg.startsWith('--owner-fallback=')) ?? '').split('=')[1]?.trim().toLowerCase() || null;

type UserDoc = UserEntity & { _id: mongoose.Types.ObjectId };

interface Counters {
  ownersAssigned: number;
  rolesBackfilled: number;
  membershipsCreatedFromGuests: number;
  displayNamesMigrated: number;
  avatarsMigrated: number;
  usersWritten: number;
}

interface OrgWithoutOwner {
  orgId: string;
  name: string;
  reason: string;
  candidates: string[];
}

function log(...args: any[]) {
  console.log(...args);
}

/** Marks a user dirty so a single write per user covers every change we made to them. */
class ChangeSet {
  private readonly dirty = new Map<string, UserDoc>();

  touch(user: UserDoc) {
    this.dirty.set(user._id.toString(), user);
  }

  get size() {
    return this.dirty.size;
  }

  entries() {
    return Array.from(this.dirty.values());
  }
}

function membershipOf(user: UserDoc, orgId: string): IUserOrganization | undefined {
  return user.organizations?.find(o => o.orgId === orgId);
}

/**
 * `auditable.createdBy` is written as an email in some collections and as a user id in others,
 * so both are tried. Personal orgs have a third path: their `_id` is forced to the owner's `_id`
 * (see `init.controller.ts`), and their `name` is the owner's email.
 */
function resolveOwner(org: OrganizationDocument, byEmail: Map<string, UserDoc>, byId: Map<string, UserDoc>): { user: UserDoc | null; via: string } {
  const orgIdStr = org._id.toString();

  if (org.type === 'personal') {
    const byForcedId = byId.get(orgIdStr);
    if (byForcedId) return { user: byForcedId, via: 'personal org _id === user._id' };
    const byName = org.name ? byEmail.get(org.name.toLowerCase()) : null;
    if (byName) return { user: byName, via: 'personal org name === user.email' };
  }

  const createdBy = (org as any).auditable?.createdBy;
  if (createdBy && typeof createdBy === 'string') {
    const ref = createdBy.trim();
    const hit = ref.includes('@') ? byEmail.get(ref.toLowerCase()) : byId.get(ref);
    if (hit) return { user: hit, via: `auditable.createdBy=${ref}` };
    return { user: null, via: `auditable.createdBy=${ref} (no matching user)` };
  }

  return { user: null, via: 'no auditable.createdBy' };
}

async function main() {
  log(`\n=== migrate-org-roles ${DRY_RUN ? '(DRY RUN — nothing will be written)' : '(APPLYING CHANGES)'} ===\n`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const userModel: Model<UserEntity> = app.get(getModelToken(UserEntity.name));
    const orgModel: Model<OrganizationDocument> = app.get(getModelToken(OrganizationEntity.name));

    const users = (await userModel.find({}).exec()) as unknown as UserDoc[];
    const orgs = await orgModel.find({}).exec();
    log(`Loaded ${users.length} users and ${orgs.length} organizations.\n`);

    const byEmail = new Map<string, UserDoc>();
    const byId = new Map<string, UserDoc>();
    for (const user of users) {
      if (user.email) byEmail.set(user.email.toLowerCase(), user);
      byId.set(user._id.toString(), user);
      if (user.id) byId.set(user.id, user);
      if (user.fbId) byId.set(user.fbId, user);
    }

    if (OWNER_FALLBACK) {
      log(byEmail.has(OWNER_FALLBACK) ? `Owner fallback for team organizations: ${OWNER_FALLBACK}\n` : `!! --owner-fallback=${OWNER_FALLBACK} matches no user — the flag will be ignored\n`);
    }

    const counters: Counters = {
      ownersAssigned: 0,
      rolesBackfilled: 0,
      membershipsCreatedFromGuests: 0,
      displayNamesMigrated: 0,
      avatarsMigrated: 0,
      usersWritten: 0,
    };
    const orgsWithoutOwner: OrgWithoutOwner[] = [];
    const changes = new ChangeSet();

    // --- Steps 3 & 4: guests[] → membership, plus displayName/avatar overrides -------------
    for (const org of orgs) {
      const orgId = org._id.toString();
      const guests: any[] = Array.isArray(org.guests) ? org.guests : [];

      for (const guest of guests) {
        const email = typeof guest?.email === 'string' ? guest.email.toLowerCase() : null;
        const user = email ? byEmail.get(email) : guest?.userId ? byId.get(guest.userId) : null;
        if (!user) {
          log(`  ! [${org.name}] guest ${guest?.email ?? guest?.userId ?? '(unknown)'} has no user account — skipped`);
          continue;
        }

        if (!user.organizations) user.organizations = [];
        let membership = membershipOf(user, orgId);

        if (!membership) {
          membership = {
            orgId,
            name: org.name,
            role: OrgRole.Member,
            status: 'active',
            joinedAt: (org as any).auditable?.createdAt || (org as any).createdAt || new Date(),
            roles: ['member'],
          };
          user.organizations.push(membership);
          counters.membershipsCreatedFromGuests++;
          changes.touch(user);
          log(`  + [${org.name}] membership created from guests[] for ${user.email}`);
        }

        if (guest?.name && !membership.displayName) {
          membership.displayName = guest.name;
          counters.displayNamesMigrated++;
          changes.touch(user);
        }
        if (guest?.image && !membership.avatar) {
          membership.avatar = guest.image;
          counters.avatarsMigrated++;
          changes.touch(user);
        }
      }
    }

    // --- Step 2: every membership without a role becomes an active member -----------------
    for (const user of users) {
      for (const membership of user.organizations ?? []) {
        let touched = false;
        if (!membership.role) {
          membership.role = OrgRole.Member;
          if (!membership.roles) membership.roles = ['member'];
          counters.rolesBackfilled++;
          touched = true;
        }
        if (!membership.status) {
          membership.status = 'active';
          touched = true;
        }
        if (!membership.joinedAt) {
          membership.joinedAt = (user as any).createdAt || new Date();
          touched = true;
        }
        if (touched) changes.touch(user);
      }
    }

    // --- Steps 1 & 5: every org gets exactly one resolvable owner -------------------------
    for (const org of orgs) {
      const orgId = org._id.toString();
      const existingOwners = users.filter(u => membershipOf(u, orgId)?.role === OrgRole.Owner);
      if (existingOwners.length > 0) continue;

      const resolved = resolveOwner(org, byEmail, byId);
      let owner = resolved.user;
      let via = resolved.via;

      // A personal organization belongs to one specific person; a fallback owner there would be
      // handing someone else's private space to a stranger. Only team orgs are covered.
      if (!owner && OWNER_FALLBACK && org.type !== 'personal') {
        const fallbackUser = byEmail.get(OWNER_FALLBACK);
        if (fallbackUser) {
          owner = fallbackUser;
          via = `--owner-fallback=${OWNER_FALLBACK}`;
        }
      }

      if (!owner) {
        orgsWithoutOwner.push({
          orgId,
          name: org.name,
          reason: via,
          candidates: users.filter(u => membershipOf(u, orgId)).map(u => u.email),
        });
        continue;
      }

      if (!owner.organizations) owner.organizations = [];
      const membership = membershipOf(owner, orgId);
      if (membership) {
        membership.role = OrgRole.Owner;
        membership.status = membership.status ?? 'active';
        membership.roles = ['owner'];
      } else {
        owner.organizations.push({
          orgId,
          name: org.name,
          role: OrgRole.Owner,
          status: 'active',
          joinedAt: (org as any).auditable?.createdAt || (org as any).createdAt || new Date(),
          roles: ['owner'],
        });
      }
      counters.ownersAssigned++;
      changes.touch(owner);
      log(`  ★ [${org.name}] owner = ${owner.email} (${via})`);
    }

    // --- Write ---------------------------------------------------------------------------
    if (!DRY_RUN) {
      for (const user of changes.entries()) {
        await userModel.updateOne({ _id: user._id }, { $set: { organizations: user.organizations } }).exec();
        counters.usersWritten++;
      }
    } else {
      counters.usersWritten = changes.size;
    }

    log('\n==================================================');
    log(DRY_RUN ? 'DRY RUN SUMMARY (nothing written)' : 'MIGRATION APPLIED');
    log('==================================================');
    log(`Owners assigned:                    ${counters.ownersAssigned}`);
    log(`Roles backfilled to 'member':       ${counters.rolesBackfilled}`);
    log(`Memberships created from guests[]:  ${counters.membershipsCreatedFromGuests}`);
    log(`displayName overrides migrated:     ${counters.displayNamesMigrated}`);
    log(`avatar overrides migrated:          ${counters.avatarsMigrated}`);
    log(`Users ${DRY_RUN ? 'that would be written' : 'written'}:             ${counters.usersWritten}`);

    // Reconciliation check the plan asks for: guests[] vs memberships, per org.
    log('\n--- guests[] vs memberships (post-migration state) ---');
    let mismatches = 0;
    for (const org of orgs) {
      const orgId = org._id.toString();
      const guestCount = Array.isArray(org.guests) ? org.guests.length : 0;
      const memberCount = users.filter(u => membershipOf(u, orgId)).length;
      // Owners never appear in guests[], so one extra member is the expected shape, not a mismatch.
      if (memberCount < guestCount) {
        mismatches++;
        log(`  ! [${org.name}] guests=${guestCount} memberships=${memberCount}`);
      }
    }
    log(mismatches === 0 ? '  OK — no organization has fewer memberships than guests.' : `  ${mismatches} organization(s) still short.`);

    if (orgsWithoutOwner.length > 0) {
      log('\n--- ORGANIZATIONS WITHOUT A RESOLVABLE OWNER (resolve by hand) ---');
      for (const o of orgsWithoutOwner) {
        log(`  • ${o.name} (${o.orgId}) — ${o.reason}`);
        log(`      members: ${o.candidates.length ? o.candidates.join(', ') : '(none)'}`);
      }
      log(`\n  ${orgsWithoutOwner.length} organization(s) left untouched. They are NOT an error — they need a human decision.`);
    } else {
      log('\nEvery organization has an owner.');
    }
    log('');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
