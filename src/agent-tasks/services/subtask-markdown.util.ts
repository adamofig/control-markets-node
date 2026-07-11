import { createHash } from 'crypto';
import { ISubtask, SubtaskStatus } from '../models/classes';

/** Prefix that marks a subtask as generated from markdown (vs. UUID ids created in the UI). */
const MD_ID_PREFIX = 'md-';

export interface IParsedCheckbox {
  name: string;
  description?: string;
  done: boolean;
}

/**
 * Extracts top-level checkboxes (`- [ ]` / `- [x]`) from a task markdown file.
 * Nested checkbox items are flattened into the description of their parent —
 * the subtask model is a flat list, not a tree.
 */
export function parseSubtasksFromMarkdown(content: string): IParsedCheckbox[] {
  if (!content) return [];
  const parsed: IParsedCheckbox[] = [];
  const lines = content.split(/\r?\n/);
  const checkboxRe = /^(\s*)-\s+\[( |x|X|\/)\]\s+(.*)$/;

  for (const line of lines) {
    const match = line.match(checkboxRe);
    if (!match) continue;
    const [, indent, mark, rawText] = match;
    const text = cleanCheckboxText(rawText);
    if (!text) continue;

    if (indent.length === 0) {
      parsed.push({ name: text, done: mark.toLowerCase() === 'x' });
    } else if (parsed.length > 0) {
      // Nested item → append to the last top-level subtask's description
      const parent = parsed[parsed.length - 1];
      parent.description = parent.description ? `${parent.description}\n- ${text}` : `- ${text}`;
    }
  }
  return parsed;
}

/** Strips markdown emphasis and link syntax so names and hash ids stay stable across cosmetic edits. */
function cleanCheckboxText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) → label
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** → bold
    .replace(/`([^`]+)`/g, '$1') // `code` → code
    .trim();
}

/** Deterministic id from the normalized name, so re-syncing never duplicates subtasks. */
export function stableSubtaskId(name: string): string {
  const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return MD_ID_PREFIX + createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

export function isMarkdownSubtaskId(id: string): boolean {
  return id?.startsWith(MD_ID_PREFIX);
}

/**
 * Merges checkboxes parsed from markdown into the existing subtask list.
 * Rules:
 * - Match by stable id (hash of the name) so completion metadata survives re-syncs.
 * - "done wins": a subtask completed in the platform is never reverted to pending by a stale file.
 * - Markdown-born subtasks (`md-` ids) missing from the file are removed;
 *   UI-created subtasks (UUID ids) are always preserved, after the markdown ones.
 */
export function mergeMarkdownSubtasks(existing: ISubtask[], parsed: IParsedCheckbox[]): ISubtask[] {
  const existingById = new Map((existing || []).map(st => [st.id, st]));
  const merged: ISubtask[] = [];

  for (const item of parsed) {
    const id = stableSubtaskId(item.name);
    const current = existingById.get(id);
    if (current) {
      const done = item.done || current.status === SubtaskStatus.DONE;
      merged.push({
        ...current,
        name: item.name,
        description: item.description ?? current.description,
        status: done ? SubtaskStatus.DONE : SubtaskStatus.PENDING,
        completedAt: done ? (current.completedAt ?? new Date()) : undefined,
        completedBy: done ? current.completedBy : undefined,
      });
    } else {
      merged.push({
        id,
        name: item.name,
        description: item.description,
        status: item.done ? SubtaskStatus.DONE : SubtaskStatus.PENDING,
        ...(item.done ? { completedAt: new Date() } : {}),
      });
    }
  }

  // Preserve UI-created subtasks (non md- ids) in their original relative order
  for (const st of existing || []) {
    if (!isMarkdownSubtaskId(st.id)) merged.push(st);
  }
  return merged;
}
