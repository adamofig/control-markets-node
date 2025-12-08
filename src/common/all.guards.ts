// import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject } from '@nestjs/common';
// import { FirebaseService } from './firebase.service';
// import { FastifyRequest } from 'fastify';

// import { AppException } from './app-exception';
// import config from 'src/config/environment';
// import { ConfigType } from '@nestjs/config';
// import { AppHttpCode } from './app-enums';

// @Injectable()
// export class AppGuard implements CanActivate {
//   constructor(@Inject(config.KEY) private configService: ConfigType<typeof config>) {}

//   async canActivate() {
//     const maintainance = this.configService.maintenance;
//     if (maintainance) {
//       throw new AppException({
//         error_message: 'Actualizaciones de servidor',
//         explanation: 'No tardaremos mas de 30 min regresa mas tarde por favor',
//       });
//     }
//     return true;
//   }
// }

// @Injectable()
// export class AdminGuard implements CanActivate {
//   constructor(private readonly fbService: FirebaseService) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();
//     // const token: AppToken = request.decodedToken;

//     // validateAdminRol(token?.roles);
//     return true;
//   }
// }

// @Injectable()
// export class AuthGuard implements CanActivate {
//   constructor(private readonly fbService: FirebaseService) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();
//     try {
//       const token = await this.decodeFirebaseToken(request);
//       request.decodedToken = token;
//       return true;
//     } catch (error) {
//       if (error?.code == 'auth/id-token-expired') {
//         throw new AppException({
//           error_message: 'Token expired',
//           explanation: 'El token ha expirado, ntp en seguida recargamos!',
//           statusCode: AppHttpCode.ErrorRefreshToken,
//         });
//       }

//       console.error(error);
//       throw new UnauthorizedException();
//     }
//   }

//   private extractTokenFromHeader(request: Request | any): string | undefined {
//     const [type, token] = request.headers.authorization?.split(' ') ?? [];
//     return type === 'Bearer' ? token : undefined;
//   }

//   private async decodeFirebaseToken(request: FastifyRequest): Promise<any> {
//     const token = this.extractTokenFromHeader(request);
//     const tokenData = await this.fbService.getTokenData(token);
//     return tokenData as any;
//   }
// }
