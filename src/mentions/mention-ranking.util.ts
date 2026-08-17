import { IMentionOption } from './models/mention.models';

/** Rows returned by one federated search. Same cap the menu renders. */
export const MENTION_SEARCH_LIMIT = 12;

/** Accent- and case-insensitive form used by every comparison here. */
export function normalizeMentionText(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Escapes a user query so it can be used inside a Mongo `$regex` without acting as a pattern. */
export function escapeRegex(value: string): string {
  return (value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ranks candidates the same way the Angular menu does: name prefix, then name substring, then
 * description. Ties keep input order, so a resolver's own ordering (recency, alphabetical) survives.
 *
 * Ranking is by relevance and not by category on purpose — each row shows its own badge instead of
 * sitting under a group header, because with interleaved matches the headers would lie.
 */
export function rankMentionOptions(options: IMentionOption[], query: string, limit = MENTION_SEARCH_LIMIT): IMentionOption[] {
  const needle = normalizeMentionText((query ?? '').trim());
  if (!needle) return options.slice(0, limit);

  const matches: { option: IMentionOption; score: number; index: number }[] = [];
  options.forEach((option, index) => {
    const name = normalizeMentionText(option.name ?? '');
    const description = normalizeMentionText(option.description ?? '');
    if (name.startsWith(needle)) matches.push({ option, score: 0, index });
    else if (name.includes(needle)) matches.push({ option, score: 1, index });
    else if (description.includes(needle)) matches.push({ option, score: 2, index });
  });

  matches.sort((a, b) => a.score - b.score || a.index - b.index);
  return matches.slice(0, limit).map(match => match.option);
}

/**
 * Removes ids already seen, keeping the first occurrence.
 *
 * Order matters at the call site: the profile's own resources are merged first, so a document that
 * is both linked to the profile and an organization source keeps its `profile` provenance — the
 * stricter, more informative one.
 */
export function dedupeMentionOptions(options: IMentionOption[]): IMentionOption[] {
  const seen = new Set<string>();
  const result: IMentionOption[] = [];
  for (const option of options) {
    if (!option?.id || seen.has(option.id)) continue;
    seen.add(option.id);
    result.push(option);
  }
  return result;
}
