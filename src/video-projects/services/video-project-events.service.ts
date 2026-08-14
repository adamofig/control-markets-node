import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Bus de eventos por proyecto para el SSE de generación masiva. Gemelo de
 * `VideoSceneEventsService`, pero con clave de proyecto: el frontend se suscribe una vez al
 * proyecto y recibe el avance de todas sus escenas, en vez de abrir un stream por escena.
 *
 * En memoria y por proceso: si el backend escala a más de una instancia hay que moverlo a un bus
 * compartido (Redis), igual que el de escenas.
 */
@Injectable()
export class VideoProjectEventsService {
  private readonly emitter = new EventEmitter();
  private logger = new Logger(VideoProjectEventsService.name);

  subscribe(projectId: string, handler: (data: any) => void) {
    this.logger.verbose(`Client subscribed to project progress: ${projectId}`);
    this.emitter.on(projectId, handler);
  }

  unsubscribe(projectId: string, handler: (data: any) => void) {
    this.logger.verbose(`Client unsubscribed from project progress: ${projectId}`);
    this.emitter.off(projectId, handler);
  }

  emit(projectId: string, data: any) {
    this.emitter.emit(projectId, data);
  }
}
