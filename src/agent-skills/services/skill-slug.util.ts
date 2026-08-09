/**
 * Slug derivation for skills.
 *
 * The wiki names folders for humans reading them in order (`02-agent-profile-specs`,
 * `03-02-control-markets-api-tasks-skill.md`), but the slug is what an agent types in a prompt
 * (`@agent-profile-specs`). The ordering prefixes are presentation, so they are stripped: a skill
 * renamed from `02-` to `05-` must not become a different address overnight.
 */

/** `10-skills/02-agent-profile-specs/SKILL.md` → the folder is what identifies the bundle */
const PRIMARY_FILE_NAMES = ['skill', 'readme', 'index'];

/** Leading `01-`, `03-02-`, `2026-08-06_` … — ordering aids, never identity */
const ORDERING_PREFIX = /^(\d+[-_.])+/;

const NON_SLUG_CHARS = /[^a-z0-9]+/g;

export function slugifySegment(segment: string): string {
  return segment
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(ORDERING_PREFIX, '')
    .replace(NON_SLUG_CHARS, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derives the bundle slug from the path of its primary markdown file.
 *
 * When the file is the folder's entry point (`SKILL.md`, `readme.md`, `index.md`) the *folder* names
 * the bundle; a single-file skill is named by its own filename. Returns an empty string when nothing
 * usable can be derived, so callers decide whether that is a skip or an error.
 */
export function deriveBundleSlug(relPathOrUrl: string): string {
  if (!relPathOrUrl) return '';

  const cleaned = String(relPathOrUrl).split(/[?#]/)[0].replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length === 0) return '';

  const fileName = segments[segments.length - 1];
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const isPrimaryFile = PRIMARY_FILE_NAMES.includes(baseName.toLowerCase());

  const identifying = isPrimaryFile && segments.length > 1 ? segments[segments.length - 2] : baseName;
  return slugifySegment(identifying);
}

/** `agent-profile-specs` + `send-inbox` → `agent-profile-specs:send-inbox` */
export function buildCapabilitySlug(bundleSlug: string, capabilitySlug: string): string {
  const bundle = slugifySegment(bundleSlug);
  const capability = slugifySegment(capabilitySlug);
  if (!bundle || !capability) return '';
  return `${bundle}:${capability}`;
}

export function isCapabilitySlug(slug: string): boolean {
  return typeof slug === 'string' && slug.includes(':');
}

/**
 * Makes `candidate` unique against slugs already taken, by appending `-2`, `-3`, …
 * Used by the migration, where two folders can legitimately reduce to the same slug once the
 * ordering prefixes are gone.
 */
export function ensureUniqueSlug(candidate: string, taken: Set<string>): string {
  if (!candidate) return candidate;
  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) suffix++;
  return `${candidate}-${suffix}`;
}
