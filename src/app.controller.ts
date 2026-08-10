import { Controller, Get, Header, HttpCode } from '@nestjs/common';
import { Public } from './auth/public.decorator';

/**
 * The API landing page and its favicon. Public by design: it is the page a human lands on when
 * they hit the host with a browser, it reads no request state and returns no data.
 */
@Public('API landing page and favicon — static HTML, reads nothing, exposes nothing.')
@Controller()
export class AppController {
  constructor() {}

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
