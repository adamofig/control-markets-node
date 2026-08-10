import { RolType } from '@dataclouder/nest-auth';
import { hasPlatformRole, isPlatformAdmin } from './platform-roles';

const DAY = 86_400_000;
const past = () => new Date(Date.now() - DAY);
const future = () => new Date(Date.now() + DAY);

/**
 * The four cases of the claim contract. The truthiness test this replaces
 * (`token?.roles?.admin`) got two of them backwards: it denied the permanent grant and accepted
 * the expired one.
 */
describe('hasPlatformRole — the claim contract', () => {
  it('denies when the key is absent', () => {
    expect(isPlatformAdmin({ roles: {} })).toBe(false);
    expect(isPlatformAdmin({ roles: { [RolType.Tester]: null } })).toBe(false);
  });

  it('grants permanently when the value is null', () => {
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: null } })).toBe(true);
  });

  it('grants while the expiry date is in the future', () => {
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: future() } })).toBe(true);
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: future().toISOString() } })).toBe(true);
  });

  it('denies once the expiry date has passed', () => {
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: past() } })).toBe(false);
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: past().toISOString() } })).toBe(false);
  });

  it('reads the claim whether it sits on roles or under claims.roles', () => {
    expect(isPlatformAdmin({ claims: { roles: { [RolType.Admin]: null } } })).toBe(true);
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: null }, claims: { roles: {} } })).toBe(true);
  });

  it('denies a malformed expiry instead of treating it as permanent', () => {
    expect(isPlatformAdmin({ roles: { [RolType.Admin]: 'not-a-date' } })).toBe(false);
  });

  it('survives a missing or empty token', () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
  });

  it('works for the other platform roles, not just admin', () => {
    const token = { roles: { [RolType.Tester]: null } };
    expect(hasPlatformRole(token, RolType.Tester)).toBe(true);
    expect(hasPlatformRole(token, RolType.Admin)).toBe(false);
  });
});

describe('regression: the truthiness test this replaces', () => {
  const legacyCheck = (token: any) => !!(token?.roles?.admin || token?.claims?.roles?.admin);

  it('denied the permanent admin — the common case, broken closed', () => {
    const permanent = { roles: { [RolType.Admin]: null } };
    expect(legacyCheck(permanent)).toBe(false);
    expect(isPlatformAdmin(permanent)).toBe(true);
  });

  it('accepted the expired admin — the dangerous case, broken open', () => {
    const expired = { roles: { [RolType.Admin]: past() } };
    expect(legacyCheck(expired)).toBe(true);
    expect(isPlatformAdmin(expired)).toBe(false);
  });
});
