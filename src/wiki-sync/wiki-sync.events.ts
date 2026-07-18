import { EventEmitter2 } from '@nestjs/event-emitter';

/** Shape of the generic entity operation (OperationDto is not re-exported by @dataclouder/nest-mongo) */
interface EntityOperation {
  action: string;
  query?: any;
  payload?: any;
}

/**
 * Internal events for the local wiki write-back (Phase 2 of the sync contract).
 * Business services emit these after any DB write; WikiWriteBackService listens
 * and mirrors the change into the local `.md` files when running locally.
 * See wiki: 02-references/09-agentic-conversations-(borges)/01-sync-md-files.md
 */
export const WIKI_TASK_CHANGED = 'wiki.task.changed';
export const WIKI_SOURCE_CHANGED = 'wiki.source.changed';
/** Emitted when a profile's own body (e.g. the Section 8 live briefing) changes from the UI. */
export const WIKI_PROFILE_CHANGED = 'wiki.profile.changed';

export interface WikiEntityChangedEvent {
  /** Mongo id (string) of the changed agent_task / source */
  id: string;
}

/** executeOperation actions that mutate a document and should trigger a write-back check */
const WRITE_ACTIONS = new Set(['create', 'updateOne', 'partialUpdate']);

/** Extracts the changed document id from a generic executeOperation call and emits the event. */
export function emitWikiChangeForOperation(emitter: EventEmitter2, event: string, operation: EntityOperation, result: any): void {
  if (!WRITE_ACTIONS.has(operation?.action)) return;
  const id = result?.id || result?._id?.toString() || operation?.query?.id || operation?.query?._id?.toString();
  if (id) {
    emitter.emit(event, { id } as WikiEntityChangedEvent);
  }
}
