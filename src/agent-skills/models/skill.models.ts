import { IAuditable } from '@dataclouder/nest-core';

/**
 * A skill lives in the repo as a *folder*, not as a file: `10-skills/02-agent-profile-specs/` holds a
 * `SKILL.md`, a `reference/` tree and a `scripts/` tree. Two document kinds mirror that shape:
 *
 * - `bundle`     — the folder itself. Carries `SKILL.md` and the index of what it can do.
 * - `capability` — one invocable operation inside the folder (`agent-profile-specs:send-inbox`),
 *                  pointing at the subset of files that operation actually needs.
 *
 * The split exists so the on-demand fetch stops being all-or-nothing: asking for one capability must
 * return its ~70 lines, not the 200+ of the whole bundle.
 */
export type SkillKind = 'bundle' | 'capability';

/** What a capability *is*, so the orchestrator knows whether to inject it or invoke it. */
export type SkillCapabilityType = 'instruction_rule' | 'mcp_tool' | 'executable_script' | 'workflow';

export type SkillFileRole = 'instruction' | 'reference' | 'script' | 'example';

/**
 * One file of the bundle folder.
 *
 * `embedded` encodes the storage decision (D1 of task 19): markdown is copied into Mongo because the
 * built-in Vercel AI SDK harness has no filesystem, while scripts are referenced by path only — the
 * ACP engines run with `cwd` on the real repo and execute them from disk, so a copy would be dead
 * weight that the delta sync still has to keep honest.
 */
export interface ISkillFile {
  /** Path relative to the bundle root, posix separators (e.g. `reference/inbox-messaging.md`) */
  relPath: string;
  role: SkillFileRole;
  embedded: boolean;
  /** Present only when `embedded` is true — canonical storage of the text */
  content?: string;
  contentHash?: string;
}

export interface ISkill {
  _id?: string;
  id?: string;
  orgId?: string;

  kind: SkillKind;

  /** Unique per org. Bundle: `agent-profile-specs`. Capability: `agent-profile-specs:send-inbox`. */
  slug: string;

  /** Capabilities only — link back to their bundle */
  bundleId?: string;
  bundleSlug?: string;

  name?: string;
  description?: string;

  /** Keywords/intents that feed the `@` autocomplete and the semantic dispatch */
  triggers?: string[];

  type?: SkillCapabilityType;

  /**
   * Denormalized concatenation of every embedded file, in `files[]` order.
   *
   * `files[].content` is canonical; this field is a cache the service owns and rewrites on every
   * write. It exists because the call-sites inherited from `sources` (context assembly, `@` mention
   * attachment) expect a source-shaped document with a flat `content`.
   */
  content?: string;

  files?: ISkillFile[];

  /** Sync contract, identical to the one `sources` already uses — reused, not reinvented */
  workspaceId?: string;
  /** Path of the bundle root (bundle) or of the primary file (capability), relative to the workspace */
  relPath?: string;
  contentHash?: string;
  /** sha256(workspaceId + ':' + relPath) */
  fingerprint?: string;

  enabled?: boolean;

  /** Set by the `sources → skills` migration so a row can be traced back to its origin */
  migratedFromSourceId?: string;

  /**
   * Ids of superseded `sources` rows that folded into this skill.
   *
   * Years of re-syncing left the same `.md` stored under a dozen different source ids, and profiles
   * still point at the old ones. Folding them into one bundle keeps the catalog honest; keeping their
   * ids resolvable here keeps those profiles working. Lookups match `aliasIds` as well as `id`.
   */
  aliasIds?: string[];

  auditable?: IAuditable;
}

/**
 * What the CLI sync sends for one skill folder, produced by `skill-bundle.util.js`.
 * The backend never walks the filesystem itself: the wiki lives on the developer's machine, and the
 * deployed backend has no access to it.
 */
export interface ISkillBundlePayload {
  slug: string;
  name?: string;
  description?: string;
  skillId?: string;
  instructionRelPath?: string;
  /** Bundle root relative to the workspace — anchors the fingerprint of every sub-resource */
  rootRelPath?: string;
  content?: string;
  files?: ISkillFile[];
  capabilities?: ISkillCapabilityPayload[];
}

export interface ISkillCapabilityPayload {
  slug: string;
  name?: string;
  description?: string;
  type?: SkillCapabilityType;
  triggers?: string[];
  files?: ISkillFile[];
}

/** Per-skill outcome of one sync run, returned so the CLI can write ids back into the `.md`. */
export interface ISkillSyncResult {
  slug: string;
  skillId: string;
  capabilities: number;
  created: boolean;
}

/** Catalog row: a bundle with the index of its capabilities. Metadata only — never carries content. */
export interface ISkillCatalogEntry {
  id: string;
  slug: string;
  name?: string;
  description?: string;
  relPath?: string;
  updatedAt?: Date;
  capabilities: ISkillCatalogCapability[];
}

export interface ISkillCatalogCapability {
  id: string;
  slug: string;
  name?: string;
  description?: string;
  type?: SkillCapabilityType;
  triggers?: string[];
}

/**
 * What the granular fetch returns. `scripts` is deliberately separate from `content`: the agent needs
 * the *path* of an executable to run it, and pasting a `.js` body into the prompt would spend the
 * tokens this whole design exists to save.
 */
export interface IResolvedSkill {
  id: string;
  slug: string;
  kind: SkillKind;
  name?: string;
  description?: string;
  type?: SkillCapabilityType;
  /** Bundle root (bundle) or primary file (capability), relative to the workspace */
  relPath?: string;
  content: string;
  /** Repo-relative paths of the non-embedded files (scripts), for the agent to execute from disk */
  scripts: string[];
  /** Present when resolving a bundle — the index of what can be requested more narrowly */
  capabilities?: ISkillCatalogCapability[];
  /** Set when the caller asked for a single `file` of the bundle */
  file?: string;
}
