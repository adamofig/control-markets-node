import { UiCapabilityRegistryService } from './ui-capability-registry.service';
import { UiContextSnapshotV1 } from '../dto/chat-request.dto';

describe('UiCapabilityRegistryService', () => {
  it('intersects enabled UI capabilities with the server catalog', () => {
    const service = new UiCapabilityRegistryService();
    const context = {
      capabilities: [
        { key: 'task.create', enabled: true },
        { key: 'agentic-profile.read', enabled: true },
        { key: 'flow.node.move', enabled: false },
        { key: 'admin.erase-everything', enabled: true },
      ],
    } as UiContextSnapshotV1;

    expect(service.authorize(context)).toEqual(['agentic-profile.read', 'task.create']);
  });
});
