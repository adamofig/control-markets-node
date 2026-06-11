import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity } from '../src/user/user.entity';
import axios from 'axios';

async function main() {
  console.log(`Bootstrapping NestJS application context to retrieve a test token...`);
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const userModel: Model<UserEntity> = app.get(getModelToken(UserEntity.name));
  
  // Find a user who has a personal access token starting with 'cm_pat_'
  const user = await userModel.findOne({ token: /^cm_pat_/ }).exec();
  
  if (!user || !user.token) {
    console.error('No user found with a valid Personal Access Token (cm_pat_...). Please register a PAT first.');
    await app.close();
    process.exit(1);
  }

  const token = user.token;
  const email = user.email;
  console.log(`Found active token for user: ${email}`);

  // Close the bootstrapped app so we don't hold the port/connections
  await app.close();

  // Entei's agentic profile ID and its orgId
  const profileId = '6a2b020850d0f40aaa5da932';
  const enteiOrgId = '6a27c95e18f26467e443f298';
  const port = process.env.PORT || '8121';
  const url = `http://localhost:${port}/api/agentic-profile/${profileId}/full-context`;

  console.log(`Performing HTTP GET request to: ${url}`);
  console.log(`Passing Header x-org-id: ${enteiOrgId}`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-org-id': enteiOrgId,
      },
    });

    console.log(`\nResponse Status: ${response.status} ${response.statusText}`);
    console.log(`Response Payload Type: ${typeof response.data}`);
    
    if (response.data && response.data.fullContextMarkdown) {
      console.log(`\nSuccessfully received fullContextMarkdown! First 800 characters:\n`);
      console.log('====================================');
      console.log(response.data.fullContextMarkdown.slice(0, 800) + '\n...');
      console.log('====================================');
    } else {
      console.log('Error: Response payload did not contain fullContextMarkdown:', response.data);
      process.exit(1);
    }
  } catch (err: any) {
    console.error('HTTP Request failed:', err.message);
    if (err.response && err.response.data) {
      console.error('Server response:', err.response.data);
    }
    process.exit(1);
  }
}

main();
