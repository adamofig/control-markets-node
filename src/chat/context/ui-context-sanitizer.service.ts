import { BadRequestException, Injectable } from '@nestjs/common';
import { chatRequestV2Schema, ChatRequestDto, UiContextSnapshotV1 } from '../dto/chat-request.dto';

const MAX_CONTEXT_INPUT_BYTES = 64 * 1024;
const MAX_CONTEXT_EFFECTIVE_BYTES = 12 * 1024;
const DENYLIST = /(^|_)(token|password|secret|api.?key|authorization|cookie|base64|credential|signed.?url)($|_)/i;

export interface UiContextSanitizeResult {
  context?: UiContextSnapshotV1;
  receivedContextHash?: string;
  redactionCount: number;
  droppedFieldCount: number;
  bytes: number;
}

@Injectable()
export class UiContextSanitizerService {
  parseRequest(body: unknown): ChatRequestDto {
    const parsed = chatRequestV2Schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Invalid chat request', issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) });
    }
    return parsed.data;
  }

  sanitize(input?: UiContextSnapshotV1): UiContextSanitizeResult {
    if (!input) return { redactionCount: 0, droppedFieldCount: 0, bytes: 0 };
    const inputBytes = this.byteLength(input);
    if (inputBytes > MAX_CONTEXT_INPUT_BYTES) throw new BadRequestException('UI context exceeds the maximum input size');

    const counters = { redactionCount: 0, droppedFieldCount: 0 };
    let context = this.sanitizeValue(input, counters, 0) as UiContextSnapshotV1;
    context = this.applyBudget(context, counters);
    const receivedContextHash = input.contextHash;
    context.contextHash = this.hash(this.hashableContext(context));

    return {
      context,
      receivedContextHash,
      ...counters,
      bytes: this.byteLength(context),
    };
  }

  private sanitizeValue(value: unknown, counters: { redactionCount: number; droppedFieldCount: number }, depth: number): unknown {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
      if (value.length > 1024) counters.droppedFieldCount += 1;
      return value.slice(0, 1024);
    }
    if (depth >= 6) {
      counters.droppedFieldCount += 1;
      return '[MAX_DEPTH]';
    }
    if (Array.isArray(value)) {
      if (value.length > 20) counters.droppedFieldCount += value.length - 20;
      return value.slice(0, 20).map(item => this.sanitizeValue(item, counters, depth + 1));
    }
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        if (DENYLIST.test(key)) {
          result[key] = '[REDACTED]';
          counters.redactionCount += 1;
        } else {
          const sanitized = this.sanitizeValue(item, counters, depth + 1);
          if (sanitized !== undefined) result[key] = sanitized;
        }
      }
      return result;
    }
    counters.droppedFieldCount += 1;
    return undefined;
  }

  private applyBudget(context: UiContextSnapshotV1, counters: { droppedFieldCount: number }): UiContextSnapshotV1 {
    if (this.byteLength(context) <= MAX_CONTEXT_EFFECTIVE_BYTES) return context;
    counters.droppedFieldCount += 2;
    let reduced: UiContextSnapshotV1 = {
      ...context,
      relatedEntities: undefined,
      form: context.form ? { ...context.form, draft: undefined } : undefined,
      selections: context.selections?.slice(0, 10),
      suggestions: context.suggestions?.slice(0, 6),
    };
    if (this.byteLength(reduced) <= MAX_CONTEXT_EFFECTIVE_BYTES) return reduced;
    counters.droppedFieldCount += 2;
    reduced = {
      ...reduced,
      primaryEntity: reduced.primaryEntity ? { ...reduced.primaryEntity, summary: undefined } : undefined,
      selections: reduced.selections?.map(selection => ({ kind: selection.kind, id: selection.id, label: selection.label, entityType: selection.entityType })),
    };
    return reduced;
  }

  private hashableContext(context: UiContextSnapshotV1): unknown {
    return {
      ...context,
      capturedAt: undefined,
      contextHash: undefined,
      sourceDiagnostics: context.sourceDiagnostics.map(source => ({ ...source, updatedAt: undefined })),
    };
  }

  private hash(value: unknown): string {
    const serialized = this.stableJson(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `ctx-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  private stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => this.stableJson(item)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`).join(',')}}`;
  }

  private byteLength(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  }
}
