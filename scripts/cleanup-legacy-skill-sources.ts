/**
 * Classifies — and optionally deletes — the skill-like rows of `sources`.
 *
 * "It will be regenerated anyway" is true for exactly one class of row: the ones whose `.md` still
 * exists in a workspace mounted on THIS host, because `sync-agent-card.js` re-ingests them. Every
 * other class is a one-way delete:
 *
 *   migrated    ya vive en `skills` (mismo id o alias)                     → duplicado puro, seguro de borrar
 *   live        `workspaceId` + relative `relPath` + the file exists here  → re-sync recreates it
 *   stale-path  `workspaceId` + relative `relPath` + the file is GONE      → nothing will recreate it
 *   foreign     `workspaceId` of a workspace not mounted here (e.g. arkham) → only that host can re-sync
 *   legacy      no `workspaceId` (absolute `file:///Users/...` URLs)       → pre-contract shape, superseded
 *   orphan      no `orgId`                                                 → unreachable by any org query
 *
 * The script also reports which agentic profiles reference each row, because deleting a source that a
 * profile still lists leaves a dangling `profile.skills[].id` until the next sync repairs it.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-legacy-skill-sources.ts
 *   … --org <orgId>                     restrict to one tenant
 *   … --delete legacy,orphan            choose classes (default: legacy,orphan)
 *   … --apply                           actually delete (dry-run otherwise)
 */
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppModule } from '../src/app.module';

type SkillRowClass = 'migrated' | 'live' | 'stale-path' | 'foreign' | 'legacy' | 'orphan';

const APPLY = process.argv.includes('--apply');
const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
};
const ORG_FILTER = argValue('--org');
const DELETE_CLASSES = new Set((argValue('--delete') || 'legacy,orphan').split(',').map(part => part.trim()).filter(Boolean) as SkillRowClass[]);

/**
 * Workspace roots on this host. The service reads `~/.control-markets/workspaces.json`, which is not
 * always present, so `LOCAL_AGENT_WORKSPACE_ROOTS` is used as the fallback with the directory
 * basename as the slug — the same convention the ACP bridge relies on.
 */
function resolveWorkspaceRoots(): Record<string, string> {
  const roots: Record<string, string> = {};

  const registryPath = path.join(os.homedir(), '.control-markets', 'workspaces.json');
  if (fs.existsSync(registryPath)) {
    try {
      Object.assign(roots, JSON.parse(fs.readFileSync(registryPath, 'utf-8')));
    } catch (err) {
      console.warn(`⚠️  Could not parse ${registryPath}: ${(err as Error).message}`);
    }
  }

  for (const root of (process.env.LOCAL_AGENT_WORKSPACE_ROOTS || '').split(',').map(part => part.trim()).filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    const slug = path.basename(root);
    if (!roots[slug]) roots[slug] = root;
  }
  return roots;
}

function classify(row: any, roots: Record<string, string>, migratedIds: Set<string>): { klass: SkillRowClass; detail: string } {
  // Checked first: once the skill answers from the `skills` collection, this row is a pure duplicate
  // no matter how healthy its path looks — nothing reads it anymore.
  if (row.id && migratedIds.has(row.id)) return { klass: 'migrated', detail: `ya vive en 'skills'` };
  if (!row.orgId) return { klass: 'orphan', detail: 'no orgId — unreachable by every org-scoped query' };
  if (!row.workspaceId) return { klass: 'legacy', detail: `no workspaceId — ${String(row.sourceUrl || '').slice(0, 70)}` };

  const root = roots[row.workspaceId];
  if (!root) return { klass: 'foreign', detail: `workspace '${row.workspaceId}' is not mounted on this host` };

  const relPath = String(row.relPath || '');
  if (!relPath || relPath.startsWith('/') || /^[a-z]+:\/\//i.test(relPath)) {
    return { klass: 'legacy', detail: `workspaceId set but relPath is absolute: ${relPath.slice(0, 70)}` };
  }

  const abs = path.join(root, relPath);
  return fs.existsSync(abs)
    ? { klass: 'live', detail: relPath }
    : { klass: 'stale-path', detail: `${relPath} — file no longer exists` };
}

async function main() {
  console.log(`\n🔎 sources → skill-like rows  (${APPLY ? 'APPLY' : 'DRY-RUN'})${ORG_FILTER ? `  org=${ORG_FILTER}` : ''}`);
  console.log(`   delete classes: ${[...DELETE_CLASSES].join(', ') || '(none)'}\n`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const db = app.get<Connection>(getConnectionToken()).db;
    const roots = resolveWorkspaceRoots();
    console.log(`   workspaces mounted here: ${Object.keys(roots).join(', ') || '(none)'}\n`);

    // Every id the `skills` collection answers to — canonical plus the aliases the migration folded.
    const migratedIds = new Set<string>();
    for (const skill of await db.collection('skills').find({}, { projection: { id: 1, aliasIds: 1 } }).toArray()) {
      if (skill.id) migratedIds.add(skill.id);
      for (const alias of skill.aliasIds || []) migratedIds.add(alias);
    }
    console.log(`   ids servidos por 'skills': ${migratedIds.size}\n`);

    const rows = await db
      .collection('sources')
      .find({ $or: [{ kind: 'skill' }, { tag: 'rule' }], ...(ORG_FILTER ? { orgId: ORG_FILTER } : {}) })
      .toArray();

    // Which profiles still point at these ids? A dangling ref is the real cost of deleting.
    const profiles = await db.collection('agentic_profiles').find({}, { projection: { id: 1, name: 1, orgId: 1, skills: 1 } }).toArray();
    const referencedBy = new Map<string, string[]>();
    for (const profile of profiles) {
      for (const skill of (profile.skills || []) as any[]) {
        if (!skill?.id) continue;
        const list = referencedBy.get(skill.id) || [];
        list.push(profile.name || profile.id);
        referencedBy.set(skill.id, list);
      }
    }

    const buckets = new Map<SkillRowClass, any[]>();
    for (const row of rows) {
      const { klass, detail } = classify(row, roots, migratedIds);
      if (!buckets.has(klass)) buckets.set(klass, []);
      buckets.get(klass).push({ row, detail, refs: referencedBy.get(row.id) || [] });
    }

    const order: SkillRowClass[] = ['migrated', 'live', 'stale-path', 'foreign', 'legacy', 'orphan'];
    const idsToDelete: any[] = [];
    let referencedAmongDeleted = 0;

    for (const klass of order) {
      const entries = buckets.get(klass) || [];
      if (entries.length === 0) continue;

      const willDelete = DELETE_CLASSES.has(klass);
      console.log(`\n${willDelete ? '🗑 ' : '🔒'} ${klass.toUpperCase()} — ${entries.length} row(s)${willDelete ? '  → WILL BE DELETED' : '  → kept'}`);

      for (const entry of entries.slice(0, 12)) {
        const refNote = entry.refs.length ? `  ⚠️ referenced by: ${entry.refs.join(', ')}` : '';
        console.log(`     ${String(entry.row.name || entry.row.id).slice(0, 46).padEnd(46)} ${entry.detail.slice(0, 72)}${refNote}`);
      }
      if (entries.length > 12) console.log(`     … and ${entries.length - 12} more`);

      if (willDelete) {
        for (const entry of entries) {
          idsToDelete.push(entry.row._id);
          // A `migrated` row's id keeps resolving — against `skills` now — so a profile pointing at
          // it is not left dangling. Only the other classes actually break a reference.
          if (entry.refs.length && klass !== 'migrated') referencedAmongDeleted++;
        }
      }
    }

    console.log(`\n📊 total: ${rows.length} | to delete: ${idsToDelete.length} | kept: ${rows.length - idsToDelete.length}`);
    if (referencedAmongDeleted) {
      console.log(`⚠️  ${referencedAmongDeleted} of the rows to delete are still referenced by a profile — those refs dangle until the next sync.`);
    }

    if (APPLY && idsToDelete.length) {
      // A delete of rows that no re-sync can recreate deserves a way back. Cheap insurance: dump the
      // exact documents to disk before removing them, so a mistake is a restore and not a loss.
      const backupDir = path.join(process.cwd(), '.backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `sources-skills-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      const doomed = await db.collection('sources').find({ _id: { $in: idsToDelete } }).toArray();
      fs.writeFileSync(backupPath, JSON.stringify(doomed, null, 2), 'utf-8');
      console.log(`\n💾 backup written: ${backupPath}  (${doomed.length} document(s))`);

      const result = await db.collection('sources').deleteMany({ _id: { $in: idsToDelete } });
      console.log(`✅ deleted ${result.deletedCount} row(s) from 'sources'.`);
    } else if (!APPLY) {
      console.log('\nDry-run only. Re-run with --apply to delete.\n');
    }
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await app.close();
    process.exit(process.exitCode ?? 0);
  }
}

main();
