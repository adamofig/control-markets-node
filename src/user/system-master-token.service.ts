import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const MASTER_TOKEN_PREFIX = 'cm_master_';

/** Minimum raw length accepted; anything shorter is refused at boot to avoid a weak platform-wide backdoor. */
const MIN_TOKEN_LENGTH = 32;

/** Identity used when the master token is not bound to any real user in the `users` collection. */
export const SYSTEM_PRINCIPAL_ID = 'system_root';
export const SYSTEM_PRINCIPAL_EMAIL = 'system@control.markets';

/**
 * System Master Token (`cm_master_*`).
 *
 * A single, long-lived credential owned by the platform itself — not by any human account — so
 * infrastructure callers (cronjobs, control-render workers, agentic runners, maintenance CLIs)
 * can always send the *same* token instead of borrowing somebody's PAT.
 *
 * The token lives only in the environment (`SYSTEM_MASTER_TOKEN`), never in MongoDB. Several
 * comma-separated values are accepted so a token can be rotated without downtime: publish the new
 * one alongside the old, migrate the callers, then drop the old one.
 *
 * Only SHA-256 digests are kept in memory, and comparison is constant-time, so neither the value
 * nor its length leaks through the guard.
 */
@Injectable()
export class SystemMasterTokenService implements OnModuleInit {
  private readonly logger = new Logger('SystemMasterToken');
  private readonly digests: Buffer[];
  private readonly rejectedCount: number;

  /** Email or user id the master token acts as by default, from `SYSTEM_MASTER_USER`. */
  public readonly defaultUserRef?: string;

  constructor() {
    const rawTokens = [
      process.env.CONTROL_MASTER_TOKEN,
      process.env.SYSTEM_MASTER_TOKEN,
    ]
      .filter(Boolean)
      .join(',');

    const configured = rawTokens
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const accepted = configured.filter((value) => value.length >= MIN_TOKEN_LENGTH);
    this.rejectedCount = configured.length - accepted.length;
    this.digests = accepted.map((value) => this.digest(value));
    this.defaultUserRef = process.env.SYSTEM_MASTER_USER?.trim() || undefined;
  }

  onModuleInit(): void {
    if (this.rejectedCount > 0) {
      this.logger.error(`Ignored ${this.rejectedCount} master token(s) shorter than ${MIN_TOKEN_LENGTH} chars. Generate one with: npm run generate:master-token`);
    }

    if (!this.isEnabled) {
      this.logger.log('Disabled — set CONTROL_MASTER_TOKEN (or SYSTEM_MASTER_TOKEN) to enable platform-level authentication.');
      return;
    }

    const identity = this.defaultUserRef ? `acting as ${this.defaultUserRef}` : `acting as the synthetic ${SYSTEM_PRINCIPAL_ID} principal (set SYSTEM_MASTER_USER to bind it to a real account)`;
    this.logger.log(`Enabled with ${this.digests.length} token(s), ${identity}.`);
  }

  public get isEnabled(): boolean {
    return this.digests.length > 0;
  }

  /** Constant-time check of a bearer credential against every configured master token. */
  public isMasterToken(token?: string): boolean {
    if (!this.isEnabled || !token) {
      return false;
    }
    const candidate = this.digest(token);
    return this.digests.some((known) => timingSafeEqual(known, candidate));
  }

  /** Builds a `cm_master_*` value suitable for `SYSTEM_MASTER_TOKEN`. */
  public static generate(): string {
    return `${MASTER_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
  }

  private digest(value: string): Buffer {
    return createHash('sha256').update(value).digest();
  }
}
