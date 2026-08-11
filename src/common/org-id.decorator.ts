import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const OrgId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  // F12: Prefer validated orgId from req.ctx (resolved by OrgContextGuard against Mongo membership)
  if (request.ctx?.orgId) {
    return request.ctx.orgId;
  }
  // Fallback to request.orgId (set by ProjectAuthGuard) or headers
  return request.orgId || request.headers?.['x-org-id'] || request.headers?.['X-Org-Id'] || undefined;
});

