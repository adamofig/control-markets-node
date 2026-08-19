import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ALL_MCP_SCOPES, McpScope, resolveAgentSessionScopes } from '../mcp/mcp-scopes';

export const EPHEMERAL_AGENT_TOKEN_PREFIX = 'cm_eat_';

/** How long a grant outlives the ACP session that asked for it, unless a caller says otherwise. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;
/** Nothing may ask for a longer life than this, whatever it passes. */
const MAX_TTL_MS = 6 * 60 * 60 * 1000;

export interface IEphemeralAgentGrant {
  /** The one organization this token can reach. Not negotiable, not overridable by a header. */
  orgId: string;
  /** The agentic profile the session belongs to, when it has one. Audit only — never authorization. */
  profileId?: string;
  /** The ACP bridge session id, so a whole session can be revoked without holding its token. */
  sessionId: string;
  /** The human the agent is acting for. Membership and role are still resolved from this identity. */
  email?: string;
  userId?: string;
  scopes: McpScope[];
  expiresAt: number;
  /** First 12 chars of the digest — safe to log, enough to correlate a request with a session. */
  fingerprint: string;
}

export interface IMintEphemeralTokenInput {
  orgId: string;
  sessionId: string;
  profileId?: string;
  email?: string;
  userId?: string;
  scopes?: McpScope[];
  ttlMs?: number;
}

/**
 * Short-lived, org-pinned, scope-limited credentials for an agentic session (`cm_eat_*`).
 *
 * ## Why not reuse what already exists
 *
 * Task 25 needs a session that runs inside a CLI subprocess to call our own `/mcp`. Two credentials
 * were already available and both are wrong for it:
 *
 * - **A PAT (`cm_pat_*`)** is a human's credential: no expiry, every organization they belong to,
 *   every tool. Handing it to a child process puts it in that process's environment, where a `ps` or
 *   a crash dump inside the container reveals it, and revoking it means revoking the human's own
 *   access everywhere. A chat turn does not need a hundredth of that power.
 * - **The master token (`cm_master_*`)** is worse in the same direction: it is platform-admin by
 *   construction and bypasses per-tenant ownership.
 *
 * So this is modelled on `SystemMasterTokenService` — the same digest-only storage, the same refusal
 * to write a secret anywhere durable — and inverted in scope: bounded instead of unlimited.
 *
 * ## Memory, not Mongo, on purpose
 *
 * A grant is worthless once its process is gone, and the bridge that owns the session lives in this
 * same process. Persisting would create a second thing to expire, to clean up and to leak. The cost
 * is that a backend restart invalidates live grants — which is correct: a restart also killed every
 * ACP subprocess that held one.
 *
 * Only the SHA-256 digest of the token is kept, so a heap dump does not yield a usable credential.
 * Lookup is by digest, so there is no scan and nothing to time.
 */
@Injectable()
export class EphemeralAgentTokenService implements OnModuleDestroy {
  private readonly logger = new Logger('EphemeralAgentToken');
  private readonly grants = new Map<string, IEphemeralAgentGrant>();
  // `.unref()` so a live sweeper never holds the process (or a Jest worker) open: this timer exists
  // to reclaim memory, and nothing is waiting on it.
  private readonly sweeper = setInterval(() => this.sweep(), 60_000).unref();

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    // Every session died with the process; leaving grants resolvable would be a window with no
    // session behind it.
    this.grants.clear();
  }

  /**
   * Issues a token for one ACP session and returns its raw value **once**.
   *
   * The raw value is never stored, so there is no way to recover it afterwards; the caller is
   * expected to hand it straight to the subprocess environment or the MCP descriptor and forget it.
   */
  mint(input: IMintEphemeralTokenInput): { token: string; grant: IEphemeralAgentGrant } {
    const raw = `${EPHEMERAL_AGENT_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
    const digest = this.digest(raw);
    const ttl = Math.min(Math.max(input.ttlMs ?? DEFAULT_TTL_MS, 60_000), MAX_TTL_MS);
    const grant: IEphemeralAgentGrant = {
      orgId: input.orgId,
      profileId: input.profileId,
      sessionId: input.sessionId,
      email: input.email,
      userId: input.userId,
      scopes: input.scopes?.length ? input.scopes : resolveAgentSessionScopes(),
      expiresAt: Date.now() + ttl,
      fingerprint: digest.slice(0, 12),
    };
    this.grants.set(digest, grant);
    this.logger.log(
      `[EAT_MINT] ${grant.fingerprint} | session=${grant.sessionId} | org=${grant.orgId} | profile=${grant.profileId ?? '-'} | scopes=${grant.scopes.join(',')} | ttl=${Math.round(ttl / 1000)}s`,
    );
    return { token: raw, grant };
  }

  /** The grant behind a token, or `null` if it never existed, expired, or was revoked. */
  resolve(token?: string): IEphemeralAgentGrant | null {
    if (!token?.startsWith(EPHEMERAL_AGENT_TOKEN_PREFIX)) return null;
    const digest = this.digest(token);
    const grant = this.grants.get(digest);
    if (!grant) return null;
    if (grant.expiresAt <= Date.now()) {
      this.grants.delete(digest);
      this.logger.warn(`[EAT_EXPIRED] ${grant.fingerprint} | session=${grant.sessionId} | org=${grant.orgId}`);
      return null;
    }
    return grant;
  }

  /** Revokes a single token. Idempotent; a token that was never minted is not an error. */
  revoke(token?: string): void {
    if (!token) return;
    const digest = this.digest(token);
    const grant = this.grants.get(digest);
    if (this.grants.delete(digest) && grant) {
      this.logger.log(`[EAT_REVOKE] ${grant.fingerprint} | session=${grant.sessionId}`);
    }
  }

  /**
   * Revokes every grant issued for one bridge session.
   *
   * The bridge keeps its session's token to pass to the subprocess, but a session can also die in
   * ways that do not go through the object holding it — a CLI crash, the idle reaper, a respawn that
   * mints a second token. Revoking by session id is what makes "the session is over" and "the
   * credential is dead" the same event.
   */
  revokeSession(sessionId: string): number {
    let revoked = 0;
    for (const [digest, grant] of this.grants) {
      if (grant.sessionId === sessionId) {
        this.grants.delete(digest);
        revoked++;
      }
    }
    if (revoked) this.logger.log(`[EAT_REVOKE_SESSION] session=${sessionId} | grants=${revoked}`);
    return revoked;
  }

  /** Live grant count. Used by the specs and worth having when a leak is suspected. */
  get size(): number {
    return this.grants.size;
  }

  /** Scopes a non-ephemeral caller (human PAT, Firebase, master token) gets: all of them. */
  static get fullScopes(): McpScope[] {
    return [...ALL_MCP_SCOPES];
  }

  private sweep(): void {
    const now = Date.now();
    for (const [digest, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(digest);
    }
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
