import { Injectable, ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, FirebaseService, PermissionClaim, PlanType, RolClaim, RolType } from '@dataclouder/nest-auth';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { UserEntity } from './user.entity';
import { SYSTEM_PRINCIPAL_EMAIL, SYSTEM_PRINCIPAL_ID, SystemMasterTokenService } from './system-master-token.service';
import { IS_PUBLIC_KEY } from 'src/auth/public.decorator';

@Injectable()
export class ProjectAuthGuard extends AuthGuard {
  private readonly logger = new Logger('ProjectAuthGuard');

  constructor(
    fbService: FirebaseService,
    @InjectModel(UserEntity.name) private userModel: Model<UserEntity>,
    private readonly masterToken: SystemMasterTokenService,
    private readonly reflector?: Reflector,
  ) {
    super(fbService);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    // `@Public()` is checked before anything else so the exception behaves identically whether this
    // guard runs locally (F10) or as APP_GUARD (F12). The reflector is optional because the guard is
    // also instantiated by hand in specs; without it nothing is public, which is the safe default.
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // F12 — this guard now runs twice on most routes: once globally as `APP_GUARD`, once from the
    // `@UseGuards(AppGuard, ProjectAuthGuard)` that F10 put on 26 controllers (kept, so the guard
    // survives anyone removing the global registration). Authenticating twice means a second
    // Firebase verification, or a second Mongo lookup on the PAT branch, for every request.
    if (request.authMethod && request.decodedToken) {
      return true;
    }

    const authHeader = request.headers.authorization;

    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (request.headers['x-api-key']) {
      token = request.headers['x-api-key'] as string;
    }

    if (this.masterToken.isMasterToken(token)) {
      await this.applyMasterContext(request);
      return true;
    }

    if (token && token.startsWith('cm_pat_')) {
      const user = await this.userModel.findOne({ token }).lean().exec();
      if (user) {
        request.decodedToken = {
          uid: user.fbId || user.id || (user as any)._id?.toString(),
          email: user.email,
          picture: user.urlPicture,
          name: user.personalData?.firstname || '',
          firebase: {
            sign_in_provider: user.authStrategy || 'custom_token',
          },
          roles: user.claims?.roles,
          claims: user.claims,
        };
        request.user = user;
        // Stays `defaultOrgId` on purpose. Doc 06 §F12 asked the PAT branch to start honouring
        // `x-org-id` when the holder is a member — that now happens one guard later, in
        // `OrgContextGuard`, which prefers the header and validates it against Mongo before
        // `@OrgId()` reads it. Honouring the header *here* would hand out an unvalidated org, which
        // is the exact hole F12 exists to close. This value is only the fallback for the handful of
        // `@Public()` routes, where no context is ever resolved.
        request.orgId = user.defaultOrgId;
        request.authMethod = 'pat';
        return true;
      }
    }

    if (!token) {
      throw new UnauthorizedException('Authentication token is required');
    }

    request.authMethod = 'firebase';
    return super.canActivate(context);
  }

  /**
   * Resolves the identity a `cm_master_*` request runs as and injects it into the request.
   *
   * The token itself carries no identity, so it borrows one: the `x-system-user` header (email or
   * user id) wins, otherwise `SYSTEM_MASTER_USER`. Impersonating a real account matters because
   * most downstream code resolves the caller from `token.email` — a purely synthetic principal
   * would 404 on those paths. When neither is set we still authenticate, as the synthetic
   * `system_root` principal, which is enough for endpoints that only need admin claims and an org.
   */
  private async applyMasterContext(request: any): Promise<void> {
    const userRef = (request.headers['x-system-user'] as string)?.trim() || this.masterToken.defaultUserRef;
    const requestedOrgId = (request.headers['x-org-id'] as string)?.trim();
    request.authMethod = 'master';

    const user = userRef ? await this.findUserByRef(userRef) : null;
    if (userRef && !user) {
      throw new UnauthorizedException(`System master token could not resolve the identity '${userRef}'`);
    }

    // The master token is a platform credential: it is always admin, whichever account it borrows.
    const roles = { ...(user?.claims?.roles ?? {}), [RolType.Admin]: null } as RolClaim;

    if (user) {
      request.decodedToken = {
        uid: user.fbId || user.id || (user as any)._id?.toString(),
        userId: user.id,
        email: user.email,
        picture: user.urlPicture,
        name: user.personalData?.firstname || '',
        firebase: { sign_in_provider: 'system_master_token' },
        roles,
        claims: { ...(user.claims ?? {}), roles },
        isSystem: true,
        isMaster: true,
      };
      request.user = user;
      request.orgId = requestedOrgId || user.defaultOrgId;
    } else {
      const claims = { userId: SYSTEM_PRINCIPAL_ID, plan: { type: PlanType.Special }, permissions: {} as PermissionClaim, roles };
      request.decodedToken = {
        uid: SYSTEM_PRINCIPAL_ID,
        userId: SYSTEM_PRINCIPAL_ID,
        email: SYSTEM_PRINCIPAL_EMAIL,
        name: 'System',
        firebase: { sign_in_provider: 'system_master_token' },
        roles,
        claims,
        isSystem: true,
        isMaster: true,
      };
      request.user = { id: SYSTEM_PRINCIPAL_ID, email: SYSTEM_PRINCIPAL_EMAIL, claims, isSystem: true, isMaster: true };
      request.orgId = requestedOrgId;
    }

    // A credential that bypasses per-user ownership must never execute silently.
    const actor = request.decodedToken.email;
    this.logger.warn(`[SYSTEM_MASTER_EXECUTION] ${request.method} ${request.url} | actor=${actor} | orgId=${request.orgId ?? '-'} | ip=${request.ip ?? '-'}`);
  }

  private async findUserByRef(ref: string): Promise<UserEntity | null> {
    if (ref.includes('@')) {
      return this.userModel.findOne({ email: ref.toLowerCase() }).lean<UserEntity>().exec();
    }
    const clauses: Record<string, unknown>[] = [{ id: ref }, { fbId: ref }];
    if (isValidObjectId(ref)) {
      clauses.push({ _id: ref });
    }
    return this.userModel.findOne({ $or: clauses }).lean<UserEntity>().exec();
  }
}
