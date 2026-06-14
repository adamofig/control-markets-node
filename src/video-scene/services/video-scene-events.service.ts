import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

@Injectable()
export class VideoSceneEventsService {
  private readonly emitter = new EventEmitter();
  private logger = new Logger(VideoSceneEventsService.name);

  subscribe(sceneId: string, handler: (data: any) => void) {
    this.logger.verbose(`Client subscribed to scene progress: ${sceneId}`);
    this.emitter.on(sceneId, handler);
  }

  unsubscribe(sceneId: string, handler: (data: any) => void) {
    this.logger.verbose(`Client unsubscribed from scene progress: ${sceneId}`);
    this.emitter.off(sceneId, handler);
  }

  emit(sceneId: string, data: any) {
    this.logger.verbose(`Emitting progress event for scene ${sceneId}: ${JSON.stringify(data)}`);
    this.emitter.emit(sceneId, data);
  }
}
