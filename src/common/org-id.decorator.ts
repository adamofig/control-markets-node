import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const OrgId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  // Fastify normalizes headers to lowercase, so x-org-id is the primary lookup
  return request.headers['x-org-id'] || request.headers['X-Org-Id'] || undefined;
});
