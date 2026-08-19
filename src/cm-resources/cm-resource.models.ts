/**
 * What the single read verb returns, whichever door asked.
 *
 * `kind` is finer-grained than `CmResourceKind` on purpose: a bundle and one of its atomic
 * capabilities arrive through the same `cm://skill/…` address, and the caller needs to know which
 * one it got — a bundle comes with `children` to narrow down, a capability is already narrow.
 */
export type CmResourceType = 'skill' | 'capability' | 'source' | 'task' | 'profile-context';

export interface CmResourceChild {
  uri: string;
  name: string;
  description?: string;
}

export interface CmResource {
  /** Canonical address of what was actually returned. */
  uri: string;
  type: CmResourceType;
  name: string;
  content: string;
  description?: string;
  /** Index of what can be requested more narrowly — present when a bundle was resolved. */
  children?: CmResourceChild[];
  /** Workspace-relative paths of executables. Never content: a script body is tokens, not knowledge. */
  scripts?: string[];
  /** True when `content` was cut at the size cap. Never a silently incomplete answer. */
  truncated?: boolean;
}

/** Who is asking. `orgId` is mandatory — see the note on `CmResourceResolver.read`. */
export interface CmResourceContext {
  orgId: string;
  /** The profile whose run this is, when there is one. Opens the profile-linked lookup path. */
  profileId?: string;
}

/**
 * Size cap for a single resource, in characters (~15k tokens at 4 chars/token).
 *
 * A document does not get to blow up the window of whoever asked for it. This is deliberately much
 * larger than the 16k-char degradation budget of task 23: there the whole index is being inlined
 * because the reader has no tools, here the caller explicitly asked for one document by address.
 */
export const CM_RESOURCE_MAX_CHARS = Number(process.env.CM_RESOURCE_MAX_CHARS || 60_000);
