export enum StatusJob {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Esta hasta podriara ser ChatMEssage el mismo que uso en el chat.
export class MessageLog {
  id: string;
  text: string;
  details: string;
  createdAt: Date;
}

export class NodeLog {
  id: string;
  type: string;
  status: StatusJob;
  messages: MessageLog[];
}

export class FlowLogs {
  id: string;
  status: StatusJob;
  nodes: Record<string, NodeLog>;
}
