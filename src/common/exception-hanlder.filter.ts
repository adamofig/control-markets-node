import { AppException, IAppException } from '@dataclouder/nest-core';
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

@Catch()
export class AllExceptionsHandler implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsHandler');

  catch(exception: Error | any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    const request = ctx.getRequest<FastifyRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    const isDebug = process.env.DEBUG_ERRORS === 'true' || process.env.ENV === 'development' || process.env.ENV === 'dev';

    // Concise logging
    if (isDebug) {
      console.error('[Full Exception Detail]', exception);
    } else {
      const msg = exception instanceof Error ? exception.message : JSON.stringify(exception);
      console.error(`[Exception] ${exception.constructor.name}: ${msg} (${request.method} ${request.url})`);
    }

    if (exception instanceof AppException) {
      status = exception.statusCode ?? status;
      response.status(status).send(exception.toJSON());
    } else if (exception?.errInfo?.details) {
      const error: IAppException = {
        error_message: 'Error de base de datos',
        exception: exception,
        path: request.url,
        explanation: 'probablemente un dato no cumple las validaciones',
      };
      response.status(status).send(error);
    } else {
      // For unhandled exceptions, don't send the full stack back to the client unless in debug mode
      const errorResponse: any = {
        err: 'Error de sistema no controlado',
        path: request.url,
        exception: exception?.toString(),
      };

      if (isDebug) {
        errorResponse.stack = exception?.stack;
      }

      response.status(status).send(errorResponse);
    }
  }
}

