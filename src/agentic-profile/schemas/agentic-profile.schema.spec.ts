import { model } from 'mongoose';
import { AgenticProfileSchema } from './agentic-profile.schema';

describe('AgenticProfile schema delegation', () => {
  const ProfileModel = model('AgenticProfileDelegationSchemaSpec', AgenticProfileSchema.clone());

  it('disables PAT delegation by default', () => {
    const profile = new ProfileModel({
      id: 'profile-1',
      orgId: 'org-1',
      agentCard: { id: 'card-1', name: 'Borges' },
    });

    expect(profile.validateSync()).toBeUndefined();
    expect(profile.delegation?.pat.enabled).toBe(false);
    expect(profile.delegation?.pat.allowedUserIds).toEqual([]);
  });

  it('declares a tenant-scoped unique Profile to Agent Card index', () => {
    expect(AgenticProfileSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { orgId: 1, 'agentCard.id': 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: {
              orgId: { $type: 'string' },
              'agentCard.id': { $type: 'string' },
            },
          }),
        ],
      ])
    );
  });
});
