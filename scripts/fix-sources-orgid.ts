import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { AgenticProfileDocument, AgenticProfileEntity } from '../src/agentic-profile/schemas/agentic-profile.schema';
import { AgentSourceDocument, AgentSourceEntity } from '../src/agent-tasks/schemas/agent-sources.schema';
import { AgentTaskDocument, AgentTaskEntity } from '../src/agent-tasks/schemas/agent-task.schema';

async function main() {
  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const profileModel: Model<AgenticProfileDocument> = app.get(getModelToken(AgenticProfileEntity.name));
    const sourceModel: Model<AgentSourceDocument> = app.get(getModelToken(AgentSourceEntity.name));
    const taskModel: Model<AgentTaskDocument> = app.get(getModelToken(AgentTaskEntity.name));

    console.log('Fetching all agentic profiles...');
    const profiles = await profileModel.find({}).exec();
    console.log(`Found ${profiles.length} agentic profiles.`);

    let totalSourcesUpdated = 0;
    let totalTasksUpdated = 0;

    for (const profile of profiles) {
      const orgId = profile.orgId;
      if (!orgId) {
        console.log(`[Profile: ${profile.name}] Skipped: No orgId defined on profile.`);
        continue;
      }

      console.log(`\nProcessing Profile: "${profile.name}" (ID: ${profile.id || profile._id}, orgId: ${orgId})`);

      // Collect all source IDs (sources, skills, memories)
      const sourceIds = new Set<string>();
      if (profile.sources && Array.isArray(profile.sources)) {
        profile.sources.forEach((s: any) => { if (s && s.id) sourceIds.add(s.id); });
      }
      if (profile.skills && Array.isArray(profile.skills)) {
        profile.skills.forEach((s: any) => { if (s && s.id) sourceIds.add(s.id); });
      }
      if (profile.memories && Array.isArray(profile.memories)) {
        profile.memories.forEach((s: any) => { if (s && s.id) sourceIds.add(s.id); });
      }

      const uniqueSourceIds = Array.from(sourceIds);
      console.log(`Found ${uniqueSourceIds.length} referenced sources/skills/memories.`);

      for (const srcId of uniqueSourceIds) {
        const query: any = {
          $or: [
            { id: srcId },
            ...(mongoose.Types.ObjectId.isValid(srcId) ? [{ _id: new mongoose.Types.ObjectId(srcId) }] : [])
          ]
        };

        const sourceDoc = await sourceModel.findOne(query).exec();
        if (!sourceDoc) {
          console.warn(`  - [Source ID: ${srcId}] Warning: Referenced source not found in database.`);
          continue;
        }

        if (sourceDoc.orgId !== orgId) {
          console.log(`  - [Source: "${sourceDoc.name}"] Updating orgId from "${sourceDoc.orgId || 'undefined'}" to "${orgId}"`);
          await sourceModel.updateOne({ _id: sourceDoc._id }, { $set: { orgId } }).exec();
          totalSourcesUpdated++;
        } else {
          console.log(`  - [Source: "${sourceDoc.name}"] Already has correct orgId "${orgId}"`);
        }
      }

      // Collect all task IDs
      const taskIds = new Set<string>();
      if (profile.tasks && Array.isArray(profile.tasks)) {
        profile.tasks.forEach((t: any) => { if (t && t.id) taskIds.add(t.id); });
      }

      const uniqueTaskIds = Array.from(taskIds);
      console.log(`Found ${uniqueTaskIds.length} referenced tasks.`);

      for (const tId of uniqueTaskIds) {
        const query: any = {
          $or: [
            { id: tId },
            ...(mongoose.Types.ObjectId.isValid(tId) ? [{ _id: new mongoose.Types.ObjectId(tId) }] : [])
          ]
        };

        const taskDoc = await taskModel.findOne(query).exec();
        if (!taskDoc) {
          console.warn(`  - [Task ID: ${tId}] Warning: Referenced task not found in database.`);
          continue;
        }

        if (taskDoc.orgId !== orgId) {
          console.log(`  - [Task: "${taskDoc.name}"] Updating orgId from "${taskDoc.orgId || 'undefined'}" to "${orgId}"`);
          await taskModel.updateOne({ _id: taskDoc._id }, { $set: { orgId } }).exec();
          totalTasksUpdated++;
        } else {
          console.log(`  - [Task: "${taskDoc.name}"] Already has correct orgId "${orgId}"`);
        }
      }
    }

    console.log('\n==================================================');
    console.log(`Synchronization and Repair Complete!`);
    console.log(`Total agent_sources updated: ${totalSourcesUpdated}`);
    console.log(`Total agent_tasks updated: ${totalTasksUpdated}`);
    console.log('==================================================\n');

  } catch (error) {
    console.error('Error during data repair execution:', error);
  } finally {
    await app.close();
  }
}

main();
