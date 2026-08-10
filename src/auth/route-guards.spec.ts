import * as fs from 'fs';
import * as path from 'path';

/**
 * The test that keeps F10 from rotting.
 *
 * Every controller in `src/` must be closed: either a class-level `@UseGuards(...)`, or — per route —
 * a method guard or an explicit `@Public('reason')`. Adding a controller without one fails here,
 * which is the whole point: the 17 open controllers were not a decision anybody made, they were
 * seventeen separate omissions nobody was measuring.
 *
 * It reads source instead of booting the Nest container on purpose: booting `AppModule` needs Mongo,
 * Firebase credentials and half a dozen external services, so that test would be skipped in CI on
 * the first bad day and stop protecting anything. Source is always available.
 *
 * F12 replaces this with the runtime version (walk the registered routes, demand a guard or
 * `@Public()`), because by then the global guard makes booting the container the accurate check.
 */
describe('route guard coverage (F10)', () => {
  const SRC = path.join(__dirname, '..');

  /** Every route decorator Nest exposes. `@All` included — it is the easiest one to forget. */
  const ROUTE_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete|Options|Head|All|Sse)\(/;

  function listControllerFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        found.push(...listControllerFiles(full));
      } else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
        found.push(full);
      }
    }
    return found;
  }

  /**
   * Splits a controller file into blocks, one per `@Controller(...)` class, so a file holding two
   * controllers (`agentic-heartbeat`) is judged class by class instead of as one blob.
   */
  function controllerBlocks(source: string): { header: string; body: string }[] {
    const lines = source.split('\n');
    const starts: number[] = [];
    lines.forEach((line, i) => {
      if (/^@Controller\(/.test(line)) starts.push(i);
    });

    return starts.map((start, idx) => {
      // The decorators of a class sit above `@Controller` — walk up while the lines still belong to it.
      let headerStart = start;
      while (headerStart > 0) {
        const prev = lines[headerStart - 1].trim();
        const belongsToHeader = prev.startsWith('@') || prev.startsWith('*') || prev.startsWith('/**') || prev.startsWith('//') || prev === '' || prev.endsWith(',') || prev.endsWith('(');
        if (!belongsToHeader) break;
        if (prev === '' && headerStart - 1 < (starts[idx - 1] ?? -1)) break;
        headerStart--;
      }
      // Decorators can also sit BELOW `@Controller` and above `export class` — `storage-asset-captions`
      // writes them that way, and a scanner that only looks up would report it as open.
      let headerEnd = start;
      while (headerEnd < lines.length - 1 && !/^\s*export\s+(abstract\s+)?class\s/.test(lines[headerEnd])) {
        headerEnd++;
      }

      const end = starts[idx + 1] !== undefined ? starts[idx + 1] : lines.length;
      return {
        header: lines.slice(Math.max(headerStart, starts[idx - 1] ?? 0), headerEnd + 1).join('\n'),
        body: lines.slice(headerEnd, end).join('\n'),
      };
    });
  }

  /** A route is covered when its own decorator block carries a guard or an explicit `@Public()`. */
  function uncoveredRoutes(body: string): string[] {
    const lines = body.split('\n');
    const uncovered: string[] = [];

    lines.forEach((line, i) => {
      if (!ROUTE_DECORATOR.test(line)) return;

      // Walk the contiguous decorator/comment block around this route.
      let start = i;
      while (start > 0) {
        const prev = lines[start - 1].trim();
        if (prev.startsWith('@') || prev.startsWith('*') || prev.startsWith('/**') || prev.startsWith('//')) start--;
        else break;
      }
      let end = i;
      while (end < lines.length - 1) {
        const next = lines[end + 1].trim();
        if (next.startsWith('@') || next.startsWith('*') || next.startsWith('//')) end++;
        else break;
      }

      const block = lines.slice(start, end + 1).join('\n');
      if (!/@UseGuards\(/.test(block) && !/@Public\(/.test(block)) {
        uncovered.push(line.trim());
      }
    });

    return uncovered;
  }

  const files = listControllerFiles(SRC);

  it('finds the controllers (guards against a broken scanner silently passing)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map(f => [path.relative(SRC, f), f]))('%s is closed', (_rel, file) => {
    const source = fs.readFileSync(file, 'utf8');

    for (const block of controllerBlocks(source)) {
      const classIsCovered = /@UseGuards\(/.test(block.header) || /@Public\(/.test(block.header);
      if (classIsCovered) continue;

      const uncovered = uncoveredRoutes(block.body);
      expect(uncovered).toEqual([]);
    }
  });

  it('every @Public() states a reason', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      // The reason itself contains parentheses (`TODO(F13)`), so the argument runs from the first
      // `(` of the decorator to the last `)` of that line, not to the first one.
      const publics = source.split('\n').filter(line => line.trim().startsWith('@Public('));
      for (const line of publics) {
        const arg = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')')).trim();
        // `Public(reason: string)` is typed as required, but an empty string would still compile.
        expect(arg.replace(/['"`]/g, '').length).toBeGreaterThan(20);
      }
    }
  });
});
