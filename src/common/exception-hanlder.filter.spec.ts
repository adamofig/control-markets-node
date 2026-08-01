import { ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsHandler } from './exception-hanlder.filter';

describe('AllExceptionsHandler', () => {
  function createHost() {
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/api/inbox/conversations' }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, send };
  }

  it('preserves HTTP status codes without returning a stack', () => {
    const { host, status, send } = createHost();

    new AllExceptionsHandler().catch(new UnauthorizedException('Authentication token is required'), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: 'Authentication token is required' }));
    expect(send.mock.calls[0][0]).not.toHaveProperty('stack');
  });

  it('does not expose unhandled exception details', () => {
    const { host, status, send } = createHost();

    new AllExceptionsHandler().catch(new Error('database password leaked'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith({
      err: 'Error de sistema no controlado',
      path: '/api/inbox/conversations',
    });
  });
});
