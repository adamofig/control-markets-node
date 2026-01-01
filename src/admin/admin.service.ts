import { Injectable } from '@nestjs/common';

import { AppUserService } from 'src/user/user.service';
import { AppAuthClaims, FirebaseService } from '@dataclouder/nest-auth';
import { AppException } from '@dataclouder/nest-core';

@Injectable()
export class AdminService {
  constructor(
    private userService: AppUserService,
    private firebaseService: FirebaseService
  ) {}

  public async deleteUserByEmail(email: string): Promise<any> {
    const user = await this.userService.findUserByEmail(email);
    if (!user) {
      try {
        const userFB = await this.firebaseService.getUserByEmail(email);
        if (userFB) {
          const result = await this.userService.deleteUserByEmail(userFB.email);
          return result;
        }
      } catch (error) {
        console.log('Error', error);
        // error.toString();
        throw new AppException({ error_message: 'No se encontro el usuario', explanation: error?.toString() });
      }
    }
    const result = await this.userService.deleteUserByEmail(email);
    return result;
  }

  public async updateClaimsByEmail(email: string, claims: AppAuthClaims): Promise<any> {
    // overrites all claims, check updateClaims from userService to update only some claims
    const response = await this.firebaseService.updateClaimsByEmail(email, claims);
    console.log('response', response);
    const update = await this.userService.updateUserByEmail(email, { claims: claims });
    return update;
  }
}
