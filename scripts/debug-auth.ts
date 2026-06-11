import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity } from '../src/user/user.entity';

async function main() {
  console.log(`Bootstrapping NestJS application context...`);
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const userModel: Model<UserEntity> = app.get(getModelToken(UserEntity.name));
  
  const user = await userModel.findOne({ token: /^cm_pat_/ }).exec();
  
  if (!user) {
    console.log('No user found with /^cm_pat_/');
  } else {
    console.log('User found:', {
      id: user.id,
      email: user.email,
      defaultOrgId: user.defaultOrgId,
      token: user.token,
    });
    
    // Simulate the exact query inside ProjectAuthGuard
    const tokenToSearch = user.token;
    const directLookup = await userModel.findOne({ token: tokenToSearch }).lean().exec();
    console.log('Direct lookup result (lean):', directLookup ? 'FOUND' : 'NOT FOUND');
  }
  
  await app.close();
}

main();
