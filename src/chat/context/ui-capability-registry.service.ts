import { Injectable } from '@nestjs/common';
import { UiContextSnapshotV1 } from '../dto/chat-request.dto';

const SERVER_CAPABILITY_CATALOG = new Set([
  'task.read',
  'task.create',
  'task.edit',
  'task.filter',
  'flow.read',
  'flow.node.move',
  'blog.read',
  'blog.create',
  'agentic-profile.read',
  'agentic-profile.create',
  'agentic-profile.edit',
  'agentic-profile.heartbeat.run',
]);

@Injectable()
export class UiCapabilityRegistryService {
  authorize(context?: UiContextSnapshotV1): string[] {
    if (!context) return [];
    return context.capabilities
      .filter(capability => capability.enabled && SERVER_CAPABILITY_CATALOG.has(capability.key))
      .map(capability => capability.key)
      .sort();
  }
}
