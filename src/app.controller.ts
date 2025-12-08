import { Controller, Get, Header, HttpCode } from '@nestjs/common';
import { join } from 'path';

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
