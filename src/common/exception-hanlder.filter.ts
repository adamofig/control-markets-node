import { AppException, IAppException } from '@dataclouder/nest-core';
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';

import { FastifyRequest } from 'fastify';

@Catch()
export class AllExceptionsHandler implements ExceptionFilter {
  catch(exception: Error | any, host: ArgumentsHost) {
    console.error('New Exception', exception);
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    const request = ctx.getRequest<FastifyRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

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
      console.log('Error no controlado', exception);
      response.status(status).send({ err: 'Error de sistema no controlado', path: request.url, exception: exception?.toString(), stack: exception?.stack });
    }
  }
}
