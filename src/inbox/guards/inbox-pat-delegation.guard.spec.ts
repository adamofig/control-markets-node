import { UnauthorizedException } from '@nestjs/common';
import { InboxPatDelegationGuard } from './inbox-pat-delegation.guard';

describe('InboxPatDelegationGuard', () => {
  const guard = new InboxPatDelegationGuard();

  function context(headers: Record<string, string>) {
    return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as any;
  }

  it('accepts a PAT from the bearer header', () => {
    expect(guard.canActivate(context({ authorization: 'Bearer cm_pat_secret' }))).toBe(true);
  });

  it('rejects Firebase and generic bearer credentials', () => {
    expect(() => guard.canActivate(context({ authorization: 'Bearer firebase-token' }))).toThrow(UnauthorizedException);
  });
});
