import { AgenticProfileService } from './agentic-profile.service';

/**
 * `updateAcpConfig` writes with `updateOne`, which does NOT run the Mongoose enum validators of
 * `AgenticProfileAcpConfigEntity`. The narrowing therefore has to happen in the service, or an
 * unknown engine would reach the ACP dispatcher at wake-up time.
 */
describe('AgenticProfileService.updateAcpConfig', () => {
  function createService() {
    const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
    const service = new AgenticProfileService({ updateOne } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, updateOne };
  }

  it('persists a full config scoped by orgId', async () => {
    const { service, updateOne } = createService();

    const saved = await service.updateAcpConfig('profile-1', { defaultEngine: 'agy', defaultModel: ' gemini-3.6-flash ', reasoningEffort: 'high' }, 'org-1');

    expect(saved).toEqual({ defaultEngine: 'agy', defaultModel: 'gemini-3.6-flash', reasoningEffort: 'high' });
    expect(updateOne).toHaveBeenCalledWith(
      { id: 'profile-1', orgId: 'org-1' },
      { $set: { acpConfig: { defaultEngine: 'agy', defaultModel: 'gemini-3.6-flash', reasoningEffort: 'high' } } },
    );
  });

  it('drops an unknown engine and effort instead of storing them', async () => {
    const { service, updateOne } = createService();

    const saved = await service.updateAcpConfig('profile-1', { defaultEngine: 'gemini' as any, defaultModel: 'x' }, 'org-1');

    expect(saved).toEqual({});
    expect(updateOne).toHaveBeenCalledWith({ id: 'profile-1', orgId: 'org-1' }, { $unset: { acpConfig: '' } });
  });

  it('ignores a model and effort sent without an engine — they are unresolvable on their own', async () => {
    const { service } = createService();

    expect(await service.updateAcpConfig('profile-1', { defaultModel: 'sonnet', reasoningEffort: 'high' }, 'org-1')).toEqual({});
  });

  it('unsets the block when no engine is chosen, so the server default applies again', async () => {
    const { service, updateOne } = createService();

    await service.updateAcpConfig('profile-1', {}, 'org-1');

    expect(updateOne).toHaveBeenCalledWith({ id: 'profile-1', orgId: 'org-1' }, { $unset: { acpConfig: '' } });
  });

  it('keeps a valid engine even when the effort is invalid for it', async () => {
    const { service } = createService();

    expect(await service.updateAcpConfig('profile-1', { defaultEngine: 'claude', reasoningEffort: 'turbo' as any }, 'org-1')).toEqual({
      defaultEngine: 'claude',
    });
  });
});
