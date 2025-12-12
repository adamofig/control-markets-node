import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import config from 'src/config/environment';
import { AppAuthClaims } from 'src/dc-claims-module/clams.class';
import { AppException } from '@dataclouder/nest-core';

@Injectable()
export class FirebaseService {
  constructor(
    private httpService: HttpService,
    @Inject(config.KEY) private configService: ConfigType<typeof config> // private configService: ConfigType<typeof environment>,
  ) {
    console.log('Initializing Firebase App');
    initializeApp({ credential: applicationDefault() });
  }

  public async getTokenData(token: string): Promise<DecodedIdToken> {
    const tokenData: DecodedIdToken = await getAuth().verifyIdToken(token);
    return tokenData;
  }

  public async getUserByEmail(email: string): Promise<any> {
    return await getAuth().getUserByEmail(email);
  }

  public async deleteUser(userId: string): Promise<any> {
    await getAuth().deleteUser(userId);
  }

  public async setClaims(userId: string, claims: AppAuthClaims): Promise<any> {
    await getAuth().setCustomUserClaims(userId, claims);
  }

  public async updateClaimsByEmail(email: string, appClaims: AppAuthClaims): Promise<any> {
    // const user = await getAuth().getUserByEmail(email);
    return await this.updateClaimsByEmail(email, appClaims);
  }

  public async getClaimsByEmail(email: string): Promise<AppAuthClaims> {
    try {
      const user = await getAuth().getUserByEmail(email);
      const claims = (user.customClaims || {}) as AppAuthClaims;
      return claims;
    } catch (error: any) {
      console.log('error', error);
      throw new AppException({ error_message: 'User not found', explanation: 'No se encontró el usario o sus permisos' });
    }
  }

  public async getClaimsById(id: string): Promise<AppAuthClaims> {
    const user = await getAuth().getUser(id);
    const claims = (user.customClaims || {}) as AppAuthClaims;
    return claims;
  }

  public async createTokenSuperAdmin(email: string): Promise<string> {
    const user = await getAuth().getUserByEmail(email);
    const customToken = await getAuth().createCustomToken(user.uid);
    const url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + this.configService.firebase.key;
    const data = { token: customToken, returnSecureToken: true };
    const token = await firstValueFrom(this.httpService.post(url, data));
    return token.data.idToken;
  }
}
