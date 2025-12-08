import { Injectable } from '@nestjs/common';

/**
 * Main application service
 * Provides basic application functionality
 */
@Injectable()
export class AppService {
  /**
   * Returns a hello world message
   * @returns A string containing the hello world message
   */
  getHello(): string {
    return 'Hello World!';
  }
}
