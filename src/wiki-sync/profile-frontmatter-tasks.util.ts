import * as YAML from 'yaml';

/**
 * The `tasks[]` block of an agent profile's YAML frontmatter — the structured replacement for the
 * `- [x] #07 P4 **[Nombre](tasks/07-x.md)**` checkbox lines of Section 6.
 *
 * Why a hand-rolled block editor instead of `YAML.parseDocument(...).toString()`: re-serializing the
 * whole frontmatter would reformat keys nobody asked to touch (quoting style, comments, the long
 * `skills[]` block) and every such cosmetic rewrite is a diff a human has to review. Only the lines
 * of the `tasks:` block are ever re-rendered here; the rest of the file — frontmatter and body —
 * stays byte-identical, which is the same contract the CLI writer honours from the other side.
 */

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/** Serialization order, identical to `COLLECTION_FIELD_ORDER.tasks` in `sync-agent-card.js`. */
const TASK_FIELD_ORDER = ['number', 'priority', 'status', 'name', 'path', 'taskId', 'description'];

export interface ProfileTaskEntry {
  number?: number;
  priority?: number;
  status?: string;
  name?: string;
  path: string;
  taskId?: string;
  description?: string;
  [key: string]: any;
}

function renderScalar(value: any): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function renderTasksBlock(entries: ProfileTaskEntry[]): string[] {
  const lines = ['tasks:'];
  for (const entry of entries) {
    const ordered = [...TASK_FIELD_ORDER.filter(field => entry[field] !== undefined), ...Object.keys(entry).filter(field => !TASK_FIELD_ORDER.includes(field))];
    const fields = ordered.filter(field => entry[field] !== undefined && entry[field] !== null && entry[field] !== '');
    if (!fields.length) continue;
    lines.push(`  - ${fields[0]}: ${renderScalar(entry[fields[0]])}`);
    for (const field of fields.slice(1)) {
      lines.push(`    ${field}: ${renderScalar(entry[field])}`);
    }
  }
  return lines;
}

/** Index range `[start, end)` of the lines belonging to a top-level key inside a frontmatter body. */
function findKeyBlock(lines: string[], key: string): { start: number; end: number } | null {
  const start = lines.findIndex(line => new RegExp(`^${key}:`).test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:/.test(lines[end])) end++;
  return { start, end };
}

/** True when the profile declares its tasks in the frontmatter, i.e. Section 6 is no longer parsed. */
export function hasFrontmatterTasks(content: string): boolean {
  const fm = (content ?? '').replace(/\r\n/g, '\n').match(FRONTMATTER_REGEX);
  if (!fm) return false;
  return findKeyBlock(fm[1].split('\n'), 'tasks') !== null;
}

/**
 * Merges what the DB knows about one task into the profile's `tasks[]` block, matching by `path`.
 *
 * Returns the updated file content, or `null` when the profile has no `tasks:` block (a profile that
 * has not migrated yet — the caller then rewrites the Section 6 checkbox line instead). Returns the
 * content unchanged when every field already agrees, so the caller can skip the write.
 *
 * `patch` fields that are `undefined` are ignored: this mirrors the DB into the index, it never
 * blanks a description or a name the file declares and mongo happens not to have.
 */
export function upsertProfileTaskEntry(content: string, taskPath: string, patch: Partial<ProfileTaskEntry>): string | null {
  const text = (content ?? '').replace(/\r\n/g, '\n');
  const fm = text.match(FRONTMATTER_REGEX);
  if (!fm) return null;

  const fmLines = fm[1].split('\n');
  const block = findKeyBlock(fmLines, 'tasks');
  if (!block) return null;

  const parsed = YAML.parse(fmLines.slice(block.start, block.end).join('\n')) || {};
  const entries: ProfileTaskEntry[] = Array.isArray(parsed.tasks) ? parsed.tasks.filter((entry: any) => entry && typeof entry === 'object') : [];

  const normalizedPath = String(taskPath).trim();
  const updates = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== null && value !== ''));

  const index = entries.findIndex(entry => String(entry?.path ?? '').trim() === normalizedPath);
  if (index === -1) {
    entries.push({ ...updates, path: normalizedPath } as ProfileTaskEntry);
  } else {
    entries[index] = { ...entries[index], ...updates, path: normalizedPath };
  }

  const rendered = renderTasksBlock(entries);
  const nextFmLines = [...fmLines.slice(0, block.start), ...rendered, ...fmLines.slice(block.end)];
  const nextFm = `---\n${nextFmLines.join('\n')}\n---`;
  return text.slice(0, fm.index) + nextFm + text.slice((fm.index ?? 0) + fm[0].length);
}
