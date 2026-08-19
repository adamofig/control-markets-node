import * as fs from 'fs';
import * as path from 'path';
import { AgenticRuntimeProfile } from '../models/agentic-profile.models';

/**
 * Renders the two lines of the context index that only make sense for SOME readers: how to pull a
 * document's content, and where the document lives.
 *
 * Both used to be emitted unconditionally by `composeFullContext`, which meant every ACP engine
 * (`agy`, `claude`, `codex`) was told to call `getSkill` — a tool registered only in the built-in
 * Vercel harness — and was handed repo-relative paths that in a container resolve under `/app`,
 * where nothing but the webpacked bundle exists. Two impossible instructions per turn, paid for in
 * tokens both times.
 *
 * The two rules this file exists to enforce:
 *   1. Never name a tool the reader does not have registered in THIS run.
 *   2. Never print a path the reader cannot open — verified against disk, not assumed.
 */

/** Names that resolve a `cm://` address. `cm_read` is the MCP spelling, `cmRead` the Vercel one. */
export const CM_READ_TOOL_NAMES = ['cm_read', 'cmRead'] as const;
/** Tools of the built-in Vercel harness (`local-agent-chat.service.ts`). */
export const SKILL_TOOL_NAME = 'getSkill';
export const SOURCE_TOOL_NAME = 'getProfileSource';

/**
 * How much content may be inlined when the reader has NO way to fetch anything (§5.1.2 of task 23).
 * ~4k tokens. Documents are inlined whole or not at all: half a manual is worse than an honest
 * "I cannot read this", because the model cannot tell it is missing the second half.
 */
export const DEGRADED_INLINE_BUDGET_CHARS = 16_000;

export type ContextAccessMode = 'legacy' | 'cm-uri' | 'profile-tools' | 'workspace-files' | 'degraded';

export type ContextEntryKind = 'knowledge' | 'skill' | 'exploration' | 'memory';

/** One indexed document, reduced to what the access decision needs. */
export interface ContextAccessEntry {
  kind: ContextEntryKind;
  id: string;
  /** Skills only: preferred address, since it survives renames. */
  slug?: string;
  /** Skills only: whether the bundle has atomic capabilities to fetch one at a time. */
  hasCapabilities?: boolean;
  /** Workspace-relative path, written by the sync (`sha256(workspaceId + ':' + relPath)` contract). */
  relPath?: string;
  /** As written in the profile markdown — a relative link, or a real http(s) URL. */
  sourceUrl?: string;
  content?: string;
}

export interface ContextAccessRendererOptions {
  budgetChars?: number;
  /** Injectable so specs can describe a filesystem without touching disk. */
  fileExists?: (absolutePath: string) => boolean;
}

const isHttpUrl = (value?: string): boolean => !!value && /^https?:\/\//i.test(value);

/**
 * Stable fingerprint of a runtime, for cache keys.
 *
 * The profile context cache is keyed by `profileId:orgId:level`; once the runtime takes part in the
 * composition it has to take part in the key too, or a built-in chat would be served the context
 * that was compiled for an ACP session five minutes earlier.
 */
export function runtimeCacheKey(runtime?: AgenticRuntimeProfile): string {
  if (!runtime) return 'legacy';
  const tools = [...(runtime.tools ?? [])].sort().join('+');
  const roots = [...(runtime.workspaceRoots ?? [])].sort().join('+');
  return `${runtime.engine}|${tools}|${roots}`;
}

export class ContextAccessRenderer {
  /** Coarse label, for the preamble and for telemetry. The real decision is taken per entry. */
  readonly mode: ContextAccessMode;

  private readonly roots: string[];
  private readonly fileExists: (absolutePath: string) => boolean;
  private readonly budgetChars: number;
  private budgetUsed = 0;
  private readonly cmReadTool?: string;
  private readonly pathCache = new Map<string, string | null>();

  constructor(
    private readonly runtime?: AgenticRuntimeProfile,
    options: ContextAccessRendererOptions = {},
  ) {
    this.fileExists = options.fileExists ?? (p => fs.existsSync(p));
    this.budgetChars = options.budgetChars ?? DEGRADED_INLINE_BUDGET_CHARS;
    this.roots = (runtime?.workspaceRoots ?? []).filter(Boolean);
    this.cmReadTool = (runtime?.tools ?? []).find(name => (CM_READ_TOOL_NAMES as readonly string[]).includes(name));
    this.mode = this.resolveMode();
  }

  /**
   * Short platform note stating what this reader can actually do. Absent in legacy mode, so the
   * callers that do not pass a runtime yet keep getting a byte-identical document.
   */
  preamble(): string {
    if (this.mode === 'legacy' || !this.runtime) return '';
    let access: string;
    switch (this.mode) {
      case 'cm-uri':
        access = `pedí cualquier documento con \`${this.cmReadTool}('cm://...')\``;
        break;
      case 'profile-tools':
        access = `traé contenido con ${[SKILL_TOOL_NAME, SOURCE_TOOL_NAME]
          .filter(name => this.hasTool(name))
          .map(name => `\`${name}\``)
          .join(' y ')}`;
        break;
      case 'workspace-files':
        access = `leé con tus herramientas de archivo las rutas indicadas abajo (workspace \`${this.roots[0]}\`)`;
        break;
      default:
        access = 'no tenés ninguna herramienta para traer documentos: lo que no esté incluido abajo es inalcanzable en esta corrida';
    }
    return (
      `> **Runtime de esta corrida** — motor \`${this.runtime.engine}\`: ${access}.\n` +
      `> No supongas otras herramientas ni otras rutas: si algo no aparece en este documento, decí que no lo tenés en vez de inventarlo.\n\n`
    );
  }

  /** The `- Ruta/URL:` line, or an empty string when the reader could not open that path. */
  locationLine(entry: ContextAccessEntry): string {
    if (this.mode === 'legacy') {
      // Pre-task-23 behavior, reproduced field by field: memories never carried a path, skills
      // preferred `relPath`, everything else printed `sourceUrl`.
      const legacy = entry.kind === 'memory' ? undefined : entry.kind === 'skill' ? entry.relPath || entry.sourceUrl : entry.sourceUrl;
      return legacy ? `- Ruta/URL: ${legacy}\n` : '';
    }
    // A real URL is a locator anyone with network access can follow — it is not a repo path and
    // never was the bait this task removes.
    if (isHttpUrl(entry.sourceUrl)) return `- Ruta/URL: ${entry.sourceUrl}\n`;
    const resolved = this.resolvePath(entry);
    return resolved ? `- Ruta/URL: ${resolved}\n` : '';
  }

  /**
   * What follows the metadata of one entry when its content is NOT already inlined (levels `basic`
   * and `medium`): the fetch hint, the file location, the inlined body, or an honest declaration
   * that the document cannot be reached from here.
   */
  accessBlock(entry: ContextAccessEntry): string {
    if (this.mode === 'legacy') return this.toolBlock(entry, SKILL_TOOL_NAME, SOURCE_TOOL_NAME);
    if (this.cmReadTool) return this.cmUriBlock(entry, this.cmReadTool);

    const toolName = entry.kind === 'skill' ? SKILL_TOOL_NAME : SOURCE_TOOL_NAME;
    if (this.hasTool(toolName)) return this.toolBlock(entry, toolName, toolName);

    const location = this.resolvePath(entry);
    if (location) return `> Está en \`${location}\` — leelo con tus herramientas de archivo.\n\n`;

    return this.inlineBlock(entry);
  }

  private resolveMode(): ContextAccessMode {
    if (!this.runtime) return 'legacy';
    if (this.cmReadTool) return 'cm-uri';
    if (this.hasTool(SKILL_TOOL_NAME) || this.hasTool(SOURCE_TOOL_NAME)) return 'profile-tools';
    if (this.roots.length > 0) return 'workspace-files';
    return 'degraded';
  }

  private hasTool(name: string): boolean {
    return (this.runtime?.tools ?? []).includes(name);
  }

  /**
   * Resolves an entry's path against the run's workspace roots, **checking the file is really
   * there**. This is what keeps the container honest: `LOCAL_AGENT_WORKSPACE_ROOTS=/app` gives a
   * root that exists and contains nothing of the wiki, so every lookup fails and no path is printed.
   *
   * Returns the path as the reader should type it: relative when it lives under the primary root
   * (which is the process `cwd` of the ACP engine), absolute when it was found under another root.
   */
  private resolvePath(entry: ContextAccessEntry): string | null {
    if (!entry.relPath || this.roots.length === 0) return null;
    const cached = this.pathCache.get(entry.relPath);
    if (cached !== undefined) return cached;

    let resolved: string | null = null;
    for (const root of this.roots) {
      const absolute = path.resolve(root, entry.relPath);
      if (this.fileExists(absolute)) {
        resolved = root === this.roots[0] ? entry.relPath : absolute;
        break;
      }
    }
    this.pathCache.set(entry.relPath, resolved);
    return resolved;
  }

  /**
   * The wording proven in production, parameterized by tool name. `skillTool`/`sourceTool` are the
   * names the caller verified as registered — never a constant, or we are back to promising tools.
   */
  private toolBlock(entry: ContextAccessEntry, skillTool: string, sourceTool: string): string {
    if (entry.kind === 'skill') {
      const address = entry.slug || entry.id;
      return entry.hasCapabilities
        ? `> Pedí solo lo que necesites con \`${skillTool}('<slug de la capacidad>')\`, o la skill completa con \`${skillTool}('${address}')\`.\n\n`
        : `> Contenido disponible bajo demanda con \`${skillTool}('${address}')\`.\n\n`;
    }
    return entry.kind === 'knowledge'
      ? `> Contenido disponible bajo demanda con \`${sourceTool}\` usando el ID anterior.\n\n`
      : `> Contenido disponible bajo demanda con \`${sourceTool}\`.\n\n`;
  }

  /**
   * Address-based fetch. The URI shape is the one task 24 formalizes; the seam is here so wiring
   * `CmResourceResolver` only means registering the tool — the index starts citing addresses on
   * its own.
   */
  private cmUriBlock(entry: ContextAccessEntry, toolName: string): string {
    if (entry.kind === 'skill') {
      const uri = `cm://skill/${entry.slug || entry.id}`;
      return entry.hasCapabilities
        ? `> Pedí solo lo que necesites con \`${toolName}('cm://skill/<slug de la capacidad>')\`, o la skill completa con \`${toolName}('${uri}')\`.\n\n`
        : `> Contenido disponible bajo demanda con \`${toolName}('${uri}')\`.\n\n`;
    }
    return `> Contenido disponible bajo demanda con \`${toolName}('cm://source/${entry.id}')\`.\n\n`;
  }

  /**
   * Last resort: the reader has no tool and no file. Degrade to `full` for this entry while the
   * shared budget lasts; past it, say so instead of pointing at something unreachable.
   */
  private inlineBlock(entry: ContextAccessEntry): string {
    const content = entry.content;
    if (!content) return `*(Contenido vacío)*\n\n`;
    const remaining = this.budgetChars - this.budgetUsed;
    if (content.length > remaining) {
      return (
        `> ⚠️ Contenido no incluido: en esta corrida no hay herramienta de lectura ni el archivo en disco, ` +
        `y el presupuesto de contexto (${this.budgetChars} caracteres) está agotado — faltan ${content.length}. ` +
        `Decí que no podés leerlo en vez de suponer qué dice.\n\n`
      );
    }
    this.budgetUsed += content.length;
    return `${content}\n\n`;
  }
}
