import { BadRequestException } from '@nestjs/common';

/**
 * The `cm://` address space: parsing and serialization only. No Mongo, no services — this file is
 * the grammar, and every door (Vercel tool, REST, `bin/cm`, MCP) is expected to speak it before it
 * touches a collection.
 *
 * Why an address at all, when four of the five legacy readers already took a bare id:
 *
 * 1. **The address is the citation.** `ContextAccessRenderer.cmUriBlock()` prints these URIs into
 *    the context index instead of a repo path, so what the model reads back is what it can ask for.
 * 2. **It survives a move.** A `relPath` breaks the day the wiki is restructured; a slug does not.
 * 3. **It is self-describing.** `cm://skill/x:y` tells the model what kind of thing it is about to
 *    pull before it pulls it, which is what cuts the exploratory round-trips.
 */

/** Canonical resource families. Everything else is an alias that normalizes into one of these. */
export type CmResourceKind = 'skill' | 'source' | 'task' | 'profile';

export const CM_SCHEME = 'cm://';

export const CM_CANONICAL_KINDS: readonly CmResourceKind[] = ['skill', 'source', 'task', 'profile'];

/**
 * Aliases, and the reason this map is not optional.
 *
 * The `@mention` system of task 22 has been emitting addresses since before this resolver existed:
 * `mentionUri()` builds `cm://{MentionKind}/{id}`, which yields `cm://knowledge/…`,
 * `cm://org_source/…`, `cm://memory/…`, `cm://exploration/…` and `cm://agentic_profile/…`. The
 * context index of task 23 emits `cm://source/…` for those same documents.
 *
 * Two dialects of the same scheme, already in production. Accepting only the canonical spelling
 * would mean the addresses the `@` menu hands the model do not resolve — recreating the five-doors
 * problem inside the commit that closes it. So the aliases are first-class input, and the canonical
 * form is what comes back out in `CmUri.uri`.
 */
export const CM_KIND_ALIASES: Readonly<Record<string, CmResourceKind>> = {
  knowledge: 'source',
  exploration: 'source',
  memory: 'source',
  org_source: 'source',
  agentic_profile: 'profile',
};

/** The only view of a profile that is readable today. */
export const CM_PROFILE_CONTEXT_PATH = 'context';

export interface CmUri {
  /** Canonical family the address resolves to. Aliases are already folded in. */
  kind: CmResourceKind;
  /**
   * The identifier inside the family.
   * - `skill`: bundle slug (`agent-profile-specs`), capability slug (`agent-profile-specs:sync`) or id.
   * - `source` / `task` / `profile`: the id.
   */
  ref: string;
  /**
   * What follows the ref.
   * - `skill`: a bundle-relative file path (`reference/sync-guide.md`).
   * - `profile`: always `context`.
   */
  path?: string;
  /** Canonical serialization — alias kinds normalized, defaults made explicit. */
  uri: string;
}

const KNOWN_KINDS_HINT = `Tipos válidos: ${CM_CANONICAL_KINDS.join(', ')} (alias aceptados: ${Object.keys(CM_KIND_ALIASES).join(', ')}).`;

const SHAPE_HINT = [
  'Formas válidas:',
  '  cm://skill/<bundle>',
  '  cm://skill/<bundle>:<capacidad>',
  '  cm://skill/<bundle>:<capacidad>/<archivo.md>',
  '  cm://source/<id>',
  '  cm://task/<id>',
  '  cm://profile/<id>/context',
].join('\n');

/**
 * `BadRequestException` rather than a bespoke error class on purpose: the same parse runs behind an
 * HTTP controller, a Vercel tool and a CLI, and this is the one shape that already turns into a 400
 * at the REST door while staying a plain `Error` everywhere else. A caller that hands us a broken
 * address gets told the grammar, not a stack trace.
 */
const invalid = (uri: string, why: string, hint = SHAPE_HINT): never => {
  throw new BadRequestException(`Dirección cm:// inválida (${JSON.stringify(uri)}): ${why}\n${hint}`);
};

/** Serializes a canonical address. Never emits an alias kind. */
export function buildCmUri(kind: CmResourceKind, ref: string, path?: string): string {
  return `${CM_SCHEME}${kind}/${ref}${path ? `/${path}` : ''}`;
}

/**
 * Parses an address into its parts, or throws with the grammar.
 *
 * Deliberately strict about three things, because each of them is a way a malformed address could
 * otherwise reach a collection query:
 * - `..` and empty segments in the path (traversal shape) are rejected outright;
 * - a skill ref carries at most one `:` — `bundle:capability`, never `bundle:a:b`;
 * - `source` and `task` take no trailing path, so a stray suffix fails loudly instead of being
 *   silently dropped and answering with a different document than the one that was asked for.
 */
export function parseCmUri(raw: string): CmUri {
  const uri = (raw ?? '').trim();
  if (!uri) invalid(raw ?? '', 'la dirección está vacía.');
  if (!uri.toLowerCase().startsWith(CM_SCHEME)) {
    invalid(uri, `el esquema debe ser \`cm://\`.`);
  }

  const rest = uri.slice(CM_SCHEME.length);
  if (!rest) invalid(uri, 'falta el tipo de recurso.');

  const segments = rest.split('/');
  const kindRaw = segments[0]?.trim().toLowerCase();
  if (!kindRaw) invalid(uri, 'falta el tipo de recurso.');

  const kind = (CM_CANONICAL_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as CmResourceKind)
    : CM_KIND_ALIASES[kindRaw];
  if (!kind) invalid(uri, `tipo de recurso desconocido \`${kindRaw}\`.`, KNOWN_KINDS_HINT);

  const ref = segments[1]?.trim();
  if (!ref) invalid(uri, 'falta el identificador del recurso.');

  const tail = segments.slice(2);
  if (tail.some(segment => segment === '' || segment === '.' || segment === '..')) {
    invalid(uri, 'la ruta tiene segmentos vacíos o relativos (`..`), que no se aceptan.');
  }
  const path = tail.length > 0 ? tail.join('/') : undefined;

  switch (kind) {
    case 'skill': {
      const colons = (ref.match(/:/g) || []).length;
      if (colons > 1) {
        invalid(uri, 'un slug de skill lleva a lo sumo un `:` (`bundle:capacidad`).');
      }
      return { kind, ref, path, uri: buildCmUri(kind, ref, path) };
    }
    case 'profile': {
      // A bare `cm://profile/<id>` is what `mentionUri('agentic_profile', id)` produces, so it has
      // to mean something: it means the compiled context, the only view that exists today.
      if (path && path !== CM_PROFILE_CONTEXT_PATH) {
        invalid(uri, `la única vista de un perfil es \`/${CM_PROFILE_CONTEXT_PATH}\`; recibí \`/${path}\`.`);
      }
      return { kind, ref, path: CM_PROFILE_CONTEXT_PATH, uri: buildCmUri(kind, ref, CM_PROFILE_CONTEXT_PATH) };
    }
    default: {
      if (path) {
        invalid(uri, `\`cm://${kind}/…\` no admite una ruta después del identificador.`);
      }
      return { kind, ref, uri: buildCmUri(kind, ref) };
    }
  }
}

/** Non-throwing variant, for call sites that treat a non-address as "not an address". */
export function tryParseCmUri(raw: string): CmUri | null {
  try {
    return parseCmUri(raw);
  } catch {
    return null;
  }
}

/** Whether a string even looks like one of our addresses. */
export function isCmUri(raw: string): boolean {
  return typeof raw === 'string' && raw.trim().toLowerCase().startsWith(CM_SCHEME);
}
