import { AppAuthClaims } from 'src/dc-claims-module/clams.class';

export interface UserClaimsDto extends AppAuthClaims {
  email: string;
}
