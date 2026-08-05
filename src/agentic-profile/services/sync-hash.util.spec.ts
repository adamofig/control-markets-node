import * as fs from 'fs';
import * as path from 'path';

import { AUTO_FRONTMATTER_KEYS, hashContent } from './sync-hash.util';
import { MARK_TO_TASK_STATUS, TASK_STATUS_MARKS, TASK_STATUS_VALUES, normalizeTaskPriority } from '../../agent-tasks/models/classes';

/**
 * The CLI script `sync-agent-card.js` duplicates the hashing contract because it runs standalone
 * (no build step, no imports from the backend). These tests are the guard against the two copies
 * drifting apart — a divergence would silently produce false "changed"/"unchanged" verdicts.
 */
const CLI_SCRIPT = path.resolve(__dirname, '../../../../control-markets-wiki/10-skills/02-agent-profile-specs/scripts/sync-agent-card.js');

describe('sync contract: auto frontmatter keys', () => {
  it('excludes status and priority from the content hash', () => {
    const base = ['---', 'taskId: "abc"', 'status: "pending"', 'priority: 2', '---', '', '# Tarea', 'cuerpo'].join('\n');
    const changed = ['---', 'taskId: "abc"', 'status: "in_review"', 'priority: 5', '---', '', '# Tarea', 'cuerpo'].join('\n');

    expect(hashContent(base)).toBe(hashContent(changed));
  });

  it('still detects a body change', () => {
    const base = ['---', 'status: "pending"', '---', '', 'cuerpo'].join('\n');
    const changed = ['---', 'status: "pending"', '---', '', 'cuerpo distinto'].join('\n');

    expect(hashContent(base)).not.toBe(hashContent(changed));
  });

  it('stays byte-identical to the CLI script copy', () => {
    if (!fs.existsSync(CLI_SCRIPT)) return; // the wiki is not always checked out next to the backend
    const script = fs.readFileSync(CLI_SCRIPT, 'utf-8');
    const match = script.match(/const AUTO_FRONTMATTER_KEYS = (\[[^\]]*\]);/);

    expect(match).not.toBeNull();
    expect(JSON.parse(match![1].replace(/'/g, '"'))).toEqual(AUTO_FRONTMATTER_KEYS);
  });
});

describe('sync contract: status marks', () => {
  it('round-trips every supported status through its checkbox mark', () => {
    for (const status of TASK_STATUS_VALUES) {
      expect(MARK_TO_TASK_STATUS[TASK_STATUS_MARKS[status]]).toBe(status);
    }
  });

  it('matches the mark table used by the CLI parser', () => {
    if (!fs.existsSync(CLI_SCRIPT)) return;
    const script = fs.readFileSync(CLI_SCRIPT, 'utf-8');
    const match = script.match(/const MARK_TO_STATUS = (\{[^}]*\});/);

    expect(match).not.toBeNull();
    // eslint-disable-next-line no-eval
    const cliTable = eval(`(${match![1]})`) as Record<string, string>;
    for (const [mark, status] of Object.entries(cliTable)) {
      expect(MARK_TO_TASK_STATUS[mark]).toBe(status);
    }
  });
});

describe('normalizeTaskPriority', () => {
  it('accepts numbers and numeric strings inside 1..5', () => {
    expect(normalizeTaskPriority(4)).toBe(4);
    expect(normalizeTaskPriority('5')).toBe(5);
    expect(normalizeTaskPriority(' 1 ')).toBe(1);
  });

  it('rejects out-of-range and non-numeric values', () => {
    for (const value of [0, 6, -1, 2.5, 'alta', '', null, undefined, {}]) {
      expect(normalizeTaskPriority(value)).toBeUndefined();
    }
  });
});
