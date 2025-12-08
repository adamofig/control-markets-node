import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

@Injectable()
export class FlowEventsService {
  private readonly emitter = new EventEmitter();
  private logger = new Logger(FlowEventsService.name);

  subscribe(flowId: string, handler: (data: any) => void) {
    this.logger.verbose(`Client subscribed to flow ${flowId}`);
    this.emitter.on(flowId, handler);
  }

  unsubscribe(flowId: string, handler: (data: any) => void) {
    this.logger.verbose(`Client unsubscribed from flow ${flowId}`);
    this.emitter.off(flowId, handler);
  }

  emit(flowId: string, data: any) {
    this.logger.verbose(`Emitting event for flow ${flowId}`);
    this.emitter.emit(flowId, data);
  }
}
