import { ContextAccessRenderer, runtimeCacheKey, ContextAccessEntry } from './context-access-hints.util';

describe('ContextAccessRenderer', () => {
  const skill: ContextAccessEntry = {
    kind: 'skill',
    id: 'skill-1',
    slug: 'agent-profile-specs',
    hasCapabilities: true,
    relPath: 'control-markets-wiki/10-skills/02-agent-profile-specs',
    content: 'SKILL BODY',
  };
  const source: ContextAccessEntry = {
    kind: 'knowledge',
    id: 'source-1',
    relPath: 'control-markets-wiki/02-references/doc.md',
    sourceUrl: '../../02-references/doc.md',
    content: 'SOURCE BODY',
  };

  const everythingExists = () => true;
  const nothingExists = () => false;

  describe('branch: the reader has the cm:// verb', () => {
    const renderer = () => new ContextAccessRenderer({ engine: 'agy', tools: ['cm_read', 'listDir'] }, { fileExists: nothingExists });

    it('addresses documents by URI with the tool name that is actually registered', () => {
      expect(renderer().accessBlock(skill)).toContain("cm_read('cm://skill/agent-profile-specs')");
      expect(renderer().accessBlock(source)).toContain("cm_read('cm://source/source-1')");
    });

    it('offers the capability-level fetch only when the bundle has capabilities', () => {
      expect(renderer().accessBlock(skill)).toContain('cm://skill/<slug de la capacidad>');
      expect(renderer().accessBlock({ ...skill, hasCapabilities: false })).not.toContain('<slug de la capacidad>');
    });

    it('uses the camelCase spelling when that is the one registered', () => {
      const camel = new ContextAccessRenderer({ engine: 'builtin', tools: ['cmRead'] }, { fileExists: nothingExists });
      expect(camel.accessBlock(source)).toContain("cmRead('cm://source/source-1')");
    });
  });

  describe('branch: the reader has the built-in profile tools', () => {
    const renderer = () => new ContextAccessRenderer({ engine: 'builtin', tools: ['getSkill', 'getProfileSource', 'readFile'] }, { fileExists: nothingExists });

    it('keeps the wording the built-in harness has always used', () => {
      expect(renderer().accessBlock(skill)).toBe(
        "> Pedí solo lo que necesites con `getSkill('<slug de la capacidad>')`, o la skill completa con `getSkill('agent-profile-specs')`.\n\n",
      );
      expect(renderer().accessBlock(source)).toBe('> Contenido disponible bajo demanda con `getProfileSource` usando el ID anterior.\n\n');
    });

    it('does not offer getSkill for skills when only getProfileSource is registered', () => {
      const partial = new ContextAccessRenderer({ engine: 'builtin', tools: ['getProfileSource'] }, { fileExists: nothingExists });
      const block = partial.accessBlock(skill);
      expect(block).not.toContain('getSkill');
      // Falls through to the next honest option — here, inlining, since there is no workspace.
      expect(block).toContain('SKILL BODY');
    });
  });

  describe('branch: the reader has the files on disk', () => {
    const runtime = { engine: 'agy' as const, tools: [], workspaceRoots: ['/workspace/control-markets'] };

    it('points at the path relative to the primary root, which is the engine cwd', () => {
      const renderer = new ContextAccessRenderer(runtime, { fileExists: everythingExists });
      expect(renderer.accessBlock(source)).toBe('> Está en `control-markets-wiki/02-references/doc.md` — leelo con tus herramientas de archivo.\n\n');
      expect(renderer.locationLine(source)).toBe('- Ruta/URL: control-markets-wiki/02-references/doc.md\n');
    });

    it('gives an absolute path when the file lives under a secondary root', () => {
      const renderer = new ContextAccessRenderer(
        { ...runtime, workspaceRoots: ['/workspace/other', '/workspace/control-markets'] },
        { fileExists: p => p.startsWith('/workspace/control-markets') },
      );
      expect(renderer.locationLine(source)).toBe('- Ruta/URL: /workspace/control-markets/control-markets-wiki/02-references/doc.md\n');
    });

    it('degrades per entry when the root exists but that file does not — the /app case', () => {
      const renderer = new ContextAccessRenderer({ engine: 'agy', tools: [], workspaceRoots: ['/app'] }, { fileExists: nothingExists });
      expect(renderer.locationLine(source)).toBe('');
      expect(renderer.accessBlock(source)).toBe('SOURCE BODY\n\n');
    });
  });

  describe('branch: the reader has nothing', () => {
    const runtime = { engine: 'agy' as const, tools: [] };

    it('inlines the content instead of promising a fetch', () => {
      const renderer = new ContextAccessRenderer(runtime, { fileExists: nothingExists });
      expect(renderer.accessBlock(skill)).toBe('SKILL BODY\n\n');
    });

    it('declares what it cannot deliver once the budget is spent, instead of truncating a document', () => {
      const renderer = new ContextAccessRenderer(runtime, { fileExists: nothingExists, budgetChars: 12 });
      expect(renderer.accessBlock({ ...skill, content: 'SHORT' })).toBe('SHORT\n\n');
      const overflow = renderer.accessBlock({ ...source, content: 'A DOCUMENT THAT NO LONGER FITS' });
      expect(overflow).toContain('Contenido no incluido');
      expect(overflow).not.toContain('A DOCUMENT THAT NO LONGER FITS');
      expect(overflow).toContain('Decí que no podés leerlo');
    });

    it('reports an empty document as empty rather than as unreachable', () => {
      const renderer = new ContextAccessRenderer(runtime, { fileExists: nothingExists });
      expect(renderer.accessBlock({ ...source, content: '' })).toBe('*(Contenido vacío)*\n\n');
    });
  });

  // The two assertions this task exists for.
  describe('the two rules', () => {
    it('never names a tool that is not registered in this run', () => {
      const renderer = new ContextAccessRenderer({ engine: 'agy', tools: [] }, { fileExists: nothingExists });
      const output = [renderer.preamble(), renderer.accessBlock(skill), renderer.accessBlock(source)].join('');
      expect(output).not.toContain('getSkill');
      expect(output).not.toContain('getProfileSource');
      expect(output).not.toContain('cm_read');
    });

    it('never prints a path the reader cannot open', () => {
      const renderer = new ContextAccessRenderer({ engine: 'agy', tools: [] }, { fileExists: nothingExists });
      expect(renderer.locationLine(skill)).toBe('');
      expect(renderer.locationLine(source)).toBe('');
      expect([renderer.accessBlock(skill), renderer.accessBlock(source)].join('')).not.toContain('Ruta/URL');
    });

    it('still prints a real URL, which is a locator and not a repo path', () => {
      const renderer = new ContextAccessRenderer({ engine: 'agy', tools: [] }, { fileExists: nothingExists });
      expect(renderer.locationLine({ kind: 'knowledge', id: 'x', sourceUrl: 'https://example.com/doc' })).toBe('- Ruta/URL: https://example.com/doc\n');
    });
  });

  describe('legacy mode (no runtime declared)', () => {
    const renderer = () => new ContextAccessRenderer(undefined, { fileExists: nothingExists });

    it('reproduces the pre-task-23 output, including its unopenable paths', () => {
      expect(renderer().locationLine(source)).toBe('- Ruta/URL: ../../02-references/doc.md\n');
      expect(renderer().locationLine(skill)).toBe('- Ruta/URL: control-markets-wiki/10-skills/02-agent-profile-specs\n');
      expect(renderer().accessBlock(skill)).toContain("getSkill('agent-profile-specs')");
      expect(renderer().accessBlock(source)).toContain('getProfileSource');
    });

    it('never printed a path for memories', () => {
      expect(renderer().locationLine({ kind: 'memory', id: 'm', relPath: 'wiki/m.md', sourceUrl: '../m.md' })).toBe('');
    });

    it('emits no runtime preamble, so existing callers get the same document', () => {
      expect(renderer().preamble()).toBe('');
    });
  });

  describe('preamble', () => {
    it('states the engine and what it can do', () => {
      const acp = new ContextAccessRenderer({ engine: 'agy', tools: [] }, { fileExists: nothingExists });
      expect(acp.preamble()).toContain('motor `agy`');
      expect(acp.preamble()).toContain('no tenés ninguna herramienta');

      const builtin = new ContextAccessRenderer({ engine: 'builtin', tools: ['getSkill', 'getProfileSource'] }, { fileExists: nothingExists });
      expect(builtin.preamble()).toContain('`getSkill` y `getProfileSource`');
    });
  });

  describe('runtimeCacheKey', () => {
    it('separates runtimes that would compose different documents', () => {
      expect(runtimeCacheKey(undefined)).toBe('legacy');
      expect(runtimeCacheKey({ engine: 'builtin', tools: ['getSkill'] })).not.toBe(runtimeCacheKey({ engine: 'agy', tools: [] }));
      expect(runtimeCacheKey({ engine: 'agy', tools: [], workspaceRoots: ['/a'] })).not.toBe(runtimeCacheKey({ engine: 'agy', tools: [], workspaceRoots: ['/b'] }));
    });

    it('is stable under tool ordering, so an unchanged runtime keeps hitting its cache entry', () => {
      expect(runtimeCacheKey({ engine: 'builtin', tools: ['b', 'a'] })).toBe(runtimeCacheKey({ engine: 'builtin', tools: ['a', 'b'] }));
    });
  });
});
