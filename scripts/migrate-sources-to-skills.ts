/**
 * Migration: `sources` (kind:'skill' | tag:'rule')  →  `skills` (kind:'bundle')
 *
 * Three properties this script owes the platform:
 *
 * 1. **The canonical `id` is preserved.** `agentic_profiles.skills[].id` points at a source id.
 *    Minting new ids here would silently orphan every profile in the workspace, so the winner of each
 *    group lands in `skills` carrying the same `_id` and `id` it had in `sources`.
 * 2. **Duplicates fold, they do not multiply.** A dry-run over the live database found 93 skill-like
 *    rows collapsing to ~30 real skills (one `.md` had 14 copies from years of re-syncing). Copies
 *    fold into the freshest row and their ids survive as `aliasIds`, which `SkillsService` matches —
 *    so a profile pointing at a superseded id still resolves.
 * 3. **Nothing is deleted.** Origin rows are marked `migratedTo: 'skills'` instead of removed, so a
 *    half-migrated database can still serve reads while phase 3 rewires the call-sites. Cleanup is a
 *    separate, verified run.
 *
 * Capabilities are NOT created here — they are declared in the `capabilities:` frontmatter of each
 * `SKILL.md` and land through the sync script (phase 2). This migration only lifts what exists.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-sources-to-skills.ts                  # dry-run, all orgs
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-sources-to-skills.ts --org <orgId>    # one tenant
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-sources-to-skills.ts --org <id> --apply
 *   … --include-orphans   also migrate rows that have no orgId (skipped by default)
 *   … --verbose           print every folded duplicate
 */
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { deriveBundleSlug } from '../src/agent-skills/services/skill-slug.util';
import { foldDuplicateSources, MigratableSource } from '../src/agent-skills/services/skill-migration.util';

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');
const INCLUDE_ORPHANS = process.argv.includes('--include-orphans');
const ORG_FILTER = (() => {
  const index = process.argv.indexOf('--org');
  return index !== -1 ? process.argv[index + 1] : undefined;
})();

function sha256(text: string): string {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}

/** The file that carries the instruction. Absolute `file://` paths of legacy rows reduce to a name. */
function primaryFileName(relPathOrUrl?: string): string {
  const cleaned = String(relPathOrUrl || '').split(/[?#]/)[0].replace(/\\/g, '/');
  return cleaned.split('/').filter(Boolean).pop() || 'SKILL.md';
}

function slugOf(source: MigratableSource): string {
  return deriveBundleSlug(source.relPath || source.sourceUrl || source.name || '') || deriveBundleSlug(source.name || '');
}

async function main() {
  console.log(`\n🔁 sources → skills  (${APPLY ? 'APPLY' : 'DRY-RUN'})${ORG_FILTER ? `  org=${ORG_FILTER}` : ''}\n`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const db = app.get<Connection>(getConnectionToken()).db;
    const sources = db.collection('sources');
    const skills = db.collection('skills');

    const query: any = {
      $or: [{ kind: 'skill' }, { tag: 'rule' }],
      migratedTo: { $ne: 'skills' },
      ...(ORG_FILTER ? { orgId: ORG_FILTER } : {}),
    };

    const rows = (await sources.find(query).toArray()) as MigratableSource[];
    const unslugged = rows.filter(row => !slugOf(row));
    const folded = foldDuplicateSources(rows.filter(row => slugOf(row)), slugOf);

    const orgKeys = [...folded.keys()].sort();
    let created = 0;
    let updated = 0;
    let absorbed = 0;
    let skippedOrphans = 0;
    let staleWinners = 0;

    for (const orgKey of orgKeys) {
      const groups = folded.get(orgKey);
      const isOrphan = orgKey === '';

      if (isOrphan && !INCLUDE_ORPHANS) {
        const rowCount = groups.reduce((total, group) => total + group.duplicateCount, 0);
        skippedOrphans += rowCount;
        console.log(`\n🏳️  (no orgId) — ${rowCount} row(s) in ${groups.length} group(s): SKIPPED.`);
        console.log(`    These are unreachable by every org-scoped query today, so they are already dead weight.`);
        console.log(`    Pass --include-orphans to migrate them anyway.`);
        continue;
      }

      const rowCount = groups.reduce((total, group) => total + group.duplicateCount, 0);
      console.log(`\n🏢 ORG ${orgKey || '(no orgId)'} — ${rowCount} row(s) → ${groups.length} skill(s)`);

      for (const group of groups) {
        const canonical = group.canonical;
        const id = canonical.id || canonical._id?.toString();
        const content: string = canonical.content || '';

        const existing = await skills.findOne({ $or: [{ _id: canonical._id }, { id }] });
        const dupNote = group.aliasIds.length ? `  (+${group.aliasIds.length} folded)` : '';

        if (existing) {
          console.log(`  ⏭  ${group.slug} — already in 'skills'${dupNote}`);
          if (APPLY) {
            await skills.updateOne({ _id: existing._id }, { $addToSet: { aliasIds: { $each: group.aliasIds } } });
            await sources.updateOne({ _id: canonical._id }, { $set: { migratedTo: 'skills' } });
            if (group.aliasIds.length) {
              await sources.updateMany({ id: { $in: group.aliasIds } }, { $set: { migratedTo: 'skills', migratedIntoSkillId: id } });
            }
          }
          updated++;
          absorbed += group.aliasIds.length;
          continue;
        }

        const doc = {
          _id: canonical._id,
          id,
          orgId: canonical.orgId,
          kind: 'bundle',
          slug: group.slug,
          name: canonical.name,
          description: (canonical as any).description,
          triggers: [],
          content,
          files: [
            {
              relPath: primaryFileName(canonical.relPath || canonical.sourceUrl),
              role: 'instruction',
              embedded: true,
              content,
              contentHash: (canonical as any).contentHash || (content ? sha256(content) : undefined),
            },
          ],
          workspaceId: canonical.workspaceId,
          relPath: canonical.relPath,
          contentHash: (canonical as any).contentHash,
          fingerprint: (canonical as any).fingerprint,
          enabled: true,
          migratedFromSourceId: id,
          aliasIds: group.aliasIds,
          auditable: (canonical as any).auditable || {},
          createdAt: (canonical as any).createdAt || new Date(),
          updatedAt: new Date(),
        };

        console.log(`  ✅ ${group.slug.padEnd(38)} ${String(content.length).padStart(6)} chars  id=${id}${dupNote}`);

        // The winner is chosen by contract conformance, not by size — deliberately, since a big legacy
        // copy is still pinned to someone's old absolute path. But a winner far smaller than what it
        // supersedes usually means the `.md` moved and its current row was never refreshed, so the
        // fix is a re-sync of that skill, not a different winner. Worth saying out loud rather than
        // letting a 161-character stub quietly become the live instruction.
        const largestFolded = Math.max(0, ...group.duplicates.map(item => (item.content || '').length));
        if (largestFolded > content.length * 2) {
          console.log(`      ⚠️  a superseded copy held ${largestFolded} chars — re-sync this skill after migrating`);
          staleWinners++;
        }

        if (VERBOSE && group.aliasIds.length) {
          for (const aliasId of group.aliasIds) console.log(`        ↳ folded ${aliasId}`);
        }

        if (APPLY) {
          await skills.insertOne(doc as any);
          await sources.updateOne({ _id: canonical._id }, { $set: { migratedTo: 'skills' } });
          if (group.aliasIds.length) {
            await sources.updateMany({ id: { $in: group.aliasIds } }, { $set: { migratedTo: 'skills', migratedIntoSkillId: id } });
          }
        }
        created++;
        absorbed += group.aliasIds.length;
      }
    }

    if (unslugged.length) {
      console.log(`\n⚠️  ${unslugged.length} row(s) skipped — no slug derivable:`);
      for (const row of unslugged.slice(0, 10)) console.log(`     ${row.id} — name='${row.name}' path='${row.relPath || row.sourceUrl || ''}'`);
    }

    console.log(`\n📊 bundles created: ${created} | already present: ${updated} | duplicates folded as aliases: ${absorbed} | orphan rows skipped: ${skippedOrphans} | unslugged: ${unslugged.length}`);
    if (staleWinners) console.log(`⚠️  ${staleWinners} skill(s) landed with content smaller than a superseded copy — re-sync them from the wiki.`);
    if (!APPLY) console.log('\nDry-run only. Re-run with --apply to write.\n');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await app.close();
    // The Nest context keeps cron timers and Mongo sockets alive; a migration must not hang a shell.
    process.exit(process.exitCode ?? 0);
  }
}

main();
