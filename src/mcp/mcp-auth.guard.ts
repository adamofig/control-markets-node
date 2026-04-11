import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class McpApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'] ?? req.headers.authorization?.replace('Bearer ', '');
    return key === process.env.MCP_API_KEY;
  }
}
