import { Controller, Get, Header, HttpCode, Sse, MessageEvent, Post, Body } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

@Controller()
export class AppController {
  private sseEvents$ = new Subject<any>();

  constructor() {}

  @Sse('sse-test')
  sseTest(): Observable<MessageEvent> {
    return this.sseEvents$.asObservable().pipe(
      map((data) => ({ data } as MessageEvent)),
    );
  }

  @Post('sse-emit')
  @HttpCode(200)
  emitEvent(@Body() body: any) {
    this.sseEvents$.next(body);
    return { success: true, emitted: body };
  }

  @Get('favicon.ico')
  @HttpCode(204)
  getFavicon() {
    // No return needed, @HttpCode handles the status
  }

  @Get()
  @Header('content-type', 'text/html')
  getHello(): string {
    return `
    <h1>Control Markets API </h1>
    <ul>
      <li><a href="/public/index.html"> Main Page </a></li>
      <li><a href="/docs"> Swagger Documentation </a></li>
    </ul>
    `;
  }
}
