import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard, FirebaseService } from '@dataclouder/nest-auth';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity } from './user.entity';

@Injectable()
export class ProjectAuthGuard extends AuthGuard {
  constructor(
    fbService: FirebaseService,
    @InjectModel(UserEntity.name) private userModel: Model<UserEntity>,
  ) {
    super(fbService);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (request.headers['x-api-key']) {
      token = request.headers['x-api-key'] as string;
    }

    if (token && token.startsWith('cm_pat_')) {
      const user = await this.userModel.findOne({ token }).lean().exec();
      if (user) {
        request.decodedToken = {
          uid: user.fbId || user.id || (user as any)._id?.toString(),
          email: user.email,
          picture: user.urlPicture,
          name: user.personalData?.firstname || '',
          firebase: {
            sign_in_provider: user.authStrategy || 'custom_token',
          },
          roles: user.claims?.roles,
          claims: user.claims,
        };
        request.user = user;
        request.orgId = user.defaultOrgId;
        return true;
      }
    }

    return super.canActivate(context);
  }
}
