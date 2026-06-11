import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AgenticProfileService } from '../src/agentic-profile/services/agentic-profile.service';

async function main() {
  const profileId = process.argv[2];
  if (!profileId) {
    console.error('Usage: npx ts-node scripts/verify-full-context.ts <profile-id> [orgId]');
    process.exit(1);
  }
  const orgId = process.argv[3];

  console.log(`Bootstrapping NestJS application context...`);
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const service = app.get(AgenticProfileService);
  
  try {
    console.log(`Generating full context for profile ID: ${profileId} (orgId: ${orgId || 'any'})`);
    const md = await service.composeFullContext(profileId, orgId);
    console.log('\n====================================');
    console.log('COMPILED MARKDOWN CONTEXT OUTPUT:');
    console.log('====================================\n');
    console.log(md);
    console.log('====================================\n');
  } catch (error: any) {
    console.error('Error composing full context:', error);
  } finally {
    await app.close();
  }
}

main();
