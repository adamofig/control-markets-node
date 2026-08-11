import * as fs from 'fs';
import * as path from 'path';

/**
 * F12 — the wiring of the two global guards, checked statically.
 *
 * Both rules below were real defects, not hypotheticals, and neither `nest build`, `tsc --noEmit`
 * nor the 260 existing tests noticed either of them: they are properties of the DI graph, and the
 * suite never builds one. The first attempt at F12 shipped an application that refused to boot.
 *
 * Source scanning, same reasoning as `route-guards.spec.ts`: booting `AppModule` needs Mongo,
 * Firebase credentials and half a dozen external services, so a boot test would be the first thing
 * skipped in CI and would stop protecting anything.
 */
describe('global guard registration (F12)', () => {
  const SRC = path.join(__dirname, '..');
  const AUTH_MODULE = path.join(SRC, 'auth', 'auth.module.ts');

  function listModuleFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        found.push(...listModuleFiles(full));
      } else if (entry.name.endsWith('.module.ts')) {
        found.push(full);
      }
    }
    return found;
  }

  /** The `exports: [ ... ]` array of a `@Module`, or an empty string when there is none. */
  function exportsBlock(source: string): string {
    const at = source.indexOf('exports:');
    if (at === -1) return '';
    const open = source.indexOf('[', at);
    if (open === -1) return '';
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '[') depth++;
      if (source[i] === ']') {
        depth--;
        if (depth === 0) return source.slice(open, i + 1);
      }
    }
    return source.slice(open);
  }

  const files = listModuleFiles(SRC);

  it('finds the modules (guards against a broken scanner silently passing)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * Nest stores an `APP_GUARD` provider under a generated token, not under `APP_GUARD`, so exporting
   * it fails `validateExportedProvider` and the whole application dies during the dependency scan
   * with `UnknownExportException`. A global enhancer is global already — exporting it buys nothing
   * and costs the boot.
   */
  it('no module exports APP_GUARD — it does not boot', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('APP_GUARD')) continue;
      expect({ file: path.relative(SRC, file), exports: exportsBlock(source).includes('APP_GUARD') }).toEqual({
        file: path.relative(SRC, file),
        exports: false,
      });
    }
  });

  /**
   * Nest applies `APP_GUARD` enhancers in the order their providers are scanned, and across modules
   * that order is decided by the shape of the import graph in `app.module.ts`. `OrgContextGuard`
   * reads `request.decodedToken`, which only exists after `ProjectAuthGuard` has run — so splitting
   * the two registrations across two modules makes a security property depend on an import list that
   * nobody edits with guards in mind. One `providers` array is the only order Nest guarantees.
   */
  it('registers every global guard in one module, so their order is not an accident', () => {
    const registrars = files.filter(file => /provide:\s*APP_GUARD/.test(fs.readFileSync(file, 'utf8')));
    expect(registrars.map(f => path.relative(SRC, f))).toEqual(['auth/auth.module.ts']);
  });

  it('authenticates before it authorizes', () => {
    const source = fs.readFileSync(AUTH_MODULE, 'utf8');
    const auth = source.indexOf('APP_GUARD, useExisting: ProjectAuthGuard');
    const authz = source.indexOf('APP_GUARD, useExisting: OrgContextGuard');

    expect(auth).toBeGreaterThan(-1);
    expect(authz).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(authz);
  });
});
