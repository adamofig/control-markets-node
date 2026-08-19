import { buildCmUri, isCmUri, parseCmUri, tryParseCmUri } from './cm-uri.util';

describe('cm-uri.util', () => {
  describe('the six shapes of the address space', () => {
    it('resolves a bundle', () => {
      expect(parseCmUri('cm://skill/agent-profile-specs')).toMatchObject({
        kind: 'skill',
        ref: 'agent-profile-specs',
        path: undefined,
        uri: 'cm://skill/agent-profile-specs',
      });
    });

    it('resolves one atomic capability, keeping the colon in the ref', () => {
      // The colon is part of the slug `SkillsService` stores, so it is not split here.
      expect(parseCmUri('cm://skill/agent-profile-specs:sync')).toMatchObject({
        kind: 'skill',
        ref: 'agent-profile-specs:sync',
        path: undefined,
      });
    });

    it('resolves an embedded document of a capability', () => {
      expect(parseCmUri('cm://skill/agent-profile-specs:sync/reference/sync-guide.md')).toMatchObject({
        kind: 'skill',
        ref: 'agent-profile-specs:sync',
        path: 'reference/sync-guide.md',
      });
    });

    it('resolves a source', () => {
      expect(parseCmUri('cm://source/6a52a32f1aac54b41b78f2bb')).toMatchObject({ kind: 'source', ref: '6a52a32f1aac54b41b78f2bb' });
    });

    it('resolves a task', () => {
      expect(parseCmUri('cm://task/6a83d8b9d1a17fb91ae5d996')).toMatchObject({ kind: 'task', ref: '6a83d8b9d1a17fb91ae5d996' });
    });

    it('resolves a profile context', () => {
      expect(parseCmUri('cm://profile/6a2aee5dca1c5b4116588897/context')).toMatchObject({
        kind: 'profile',
        ref: '6a2aee5dca1c5b4116588897',
        path: 'context',
      });
    });
  });

  describe('the mention dialect resolves too', () => {
    // `mentionUri()` has been emitting these since task 22. Rejecting them would mean the addresses
    // the `@` menu hands the model do not resolve — the five-doors problem, recreated.
    it.each([
      ['cm://knowledge/abc', 'cm://source/abc'],
      ['cm://exploration/abc', 'cm://source/abc'],
      ['cm://memory/abc', 'cm://source/abc'],
      ['cm://org_source/abc', 'cm://source/abc'],
    ])('%s normalizes to %s', (input, canonical) => {
      const parsed = parseCmUri(input);
      expect(parsed.kind).toBe('source');
      expect(parsed.uri).toBe(canonical);
    });

    it('cm://agentic_profile/<id> means the compiled context', () => {
      expect(parseCmUri('cm://agentic_profile/p1')).toMatchObject({ kind: 'profile', ref: 'p1', path: 'context' });
    });

    it('a bare cm://profile/<id> defaults to /context', () => {
      expect(parseCmUri('cm://profile/p1').uri).toBe('cm://profile/p1/context');
    });
  });

  describe('malformed addresses fail with a legible message', () => {
    it.each([
      ['cm://', 'falta el tipo de recurso'],
      ['cm://skill/', 'falta el identificador'],
      ['', 'la dirección está vacía'],
      ['skill/foo', 'el esquema debe ser'],
      ['https://example.com/doc.md', 'el esquema debe ser'],
      ['cm://banana/x', 'tipo de recurso desconocido'],
      ['cm://skill/a:b:c', 'a lo sumo un `:`'],
      ['cm://source/abc/extra', 'no admite una ruta'],
      ['cm://task/abc/extra', 'no admite una ruta'],
      ['cm://profile/p1/settings', 'la única vista de un perfil'],
      ['cm://skill/foo/../../etc/passwd', 'segmentos vacíos o relativos'],
    ])('%s → %s', (input, fragment) => {
      expect(() => parseCmUri(input)).toThrow(expect.objectContaining({ message: expect.stringContaining(fragment) }));
    });
  });

  describe('helpers', () => {
    it('serializes canonically', () => {
      expect(buildCmUri('skill', 'a:b', 'reference/x.md')).toBe('cm://skill/a:b/reference/x.md');
      expect(buildCmUri('source', 'id1')).toBe('cm://source/id1');
    });

    it('round-trips: parse(build(x)) === x', () => {
      const uri = buildCmUri('skill', 'agent-profile-specs:sync', 'reference/x.md');
      expect(parseCmUri(uri).uri).toBe(uri);
    });

    it('tryParseCmUri returns null instead of throwing', () => {
      expect(tryParseCmUri('not-an-address')).toBeNull();
      expect(tryParseCmUri('cm://source/x')).not.toBeNull();
    });

    it('isCmUri only checks the shape, never the validity', () => {
      expect(isCmUri('cm://whatever')).toBe(true);
      expect(isCmUri('6a52a32f1aac54b41b78f2bb')).toBe(false);
    });

    it('tolerates surrounding whitespace, which is how a model pastes an address', () => {
      expect(parseCmUri('  cm://source/abc \n').uri).toBe('cm://source/abc');
    });
  });
});
