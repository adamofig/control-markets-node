import * as crypto from 'crypto';

/**
 * Universal sync contract hashing (see wiki: 02-references/09-agentic-conversations-(borges)/01-sync-md-files.md).
 *
 * IMPORTANT: the normalization here MUST stay byte-identical to the copy in the CLI script
 * `control-markets-wiki/10-skills/02-agent-profile-specs/scripts/sync-agent-card.js`.
 * If they diverge, the delta sync will report false changes (or worse, false skips).
 */

/** Frontmatter keys written back by the sync itself — excluded from the hash so a
 * write-back of IDs/status doesn't invalidate the content hash of the next run. */
export const AUTO_FRONTMATTER_KEYS = ['taskId', 'sourceId', 'orgId', 'agenticProfileId', 'status'];

export function normalizeForHash(content: string): string {
  let text = (content ?? '').replace(/\r\n/g, '\n');
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const kept = fmMatch[1]
      .split('\n')
      .filter(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return true;
        return !AUTO_FRONTMATTER_KEYS.includes(line.slice(0, idx).trim());
      })
      .join('\n');
    text = text.slice(0, fmMatch.index) + `---\n${kept}\n---` + text.slice((fmMatch.index ?? 0) + fmMatch[0].length);
  }
  return text.trim();
}

/** State key of the contract: answers "did the content change?" */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(normalizeForHash(content), 'utf8').digest('hex');
}

/** Location-identity key of the contract: answers "which file is this?".
 * Never feed absolute paths here — relPath must be relative to the workspace root. */
export function buildFingerprint(workspaceId: string, relPath: string): string {
  return crypto.createHash('sha256').update(`${workspaceId}:${relPath}`, 'utf8').digest('hex');
}
