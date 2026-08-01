import { AppException, IAppException } from '@dataclouder/nest-core';
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

@Catch()
export class AllExceptionsHandler implements ExceptionFilter {
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
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      response.status(status).send(typeof exceptionResponse === 'string' ? { statusCode: status, message: exceptionResponse } : exceptionResponse);
    } else if (exception?.errInfo?.details) {
      const error: IAppException = {
        error_message: 'Error de base de datos',
        path: request.url,
        explanation: 'probablemente un dato no cumple las validaciones',
      };
      response.status(status).send(error);
    } else {
      const errorResponse = {
        err: 'Error de sistema no controlado',
        path: request.url,
      };

      response.status(status).send(errorResponse);
    }
  }
}
