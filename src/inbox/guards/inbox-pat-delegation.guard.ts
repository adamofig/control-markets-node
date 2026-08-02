import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InboxPatDelegationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization as string | undefined;
    const apiKey = request.headers['x-api-key'] as string | undefined;
    const credential = authorization?.startsWith('Bearer ') ? authorization.slice(7) : apiKey;

    if (!credential?.startsWith('cm_pat_')) {
      throw new UnauthorizedException('Agent delegation requires a Personal Access Token');
    }
    return true;
  }
}
