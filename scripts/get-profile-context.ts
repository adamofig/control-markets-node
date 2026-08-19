import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AgenticProfileService } from '../src/agentic-profile/services/agentic-profile.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgenticProfileDocument, AgenticProfileEntity } from '../src/agentic-profile/schemas/agentic-profile.schema';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/get-profile-context.ts <agent-name | profile-id | path-to-md>');
    process.exit(1);
  }
  
  console.log(`Bootstrapping NestJS application context...`);
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const service = app.get(AgenticProfileService);
    const profileModel: Model<AgenticProfileDocument> = app.get(getModelToken(AgenticProfileEntity.name));
    
    let profileId = '';
    let orgId = '';
    let agentName = '';
    
    // Check if it's a file path
    const resolvedPath = path.resolve(arg);
    if (fs.existsSync(resolvedPath)) {
      console.log(`Parsing file frontmatter for agent profile metadata: ${resolvedPath}`);
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
      const fmMatch = content.match(frontmatterRegex);
      if (fmMatch) {
        const fmText = fmMatch[1];
        fmText.split(/\r?\n/).forEach(line => {
          // Top-level keys only. The `tasks:`/`skills:` arrays carry their own `name:` entries, and
          // reading those made the output file be named after the last task in the profile.
          if (/^\s/.test(line) || line.startsWith('-')) return;
          const colonIndex = line.indexOf(':');
          if (colonIndex !== -1) {
            const key = line.slice(0, colonIndex).trim();
            const val = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
            if (key === 'agenticProfileId') {
              profileId = val;
            } else if (key === 'orgId') {
              orgId = val;
            } else if (key === 'name') {
              agentName = val;
            }
          }
        });
      }
      
      if (!profileId) {
        // Fallback: try finding by H1 name in the file or file name
        const titleMatch = content.match(/^#\s+([^\r\n—-]+?)\s*(?:[—-]\s*([^\r\n]+))?$/m);
        agentName = agentName || (titleMatch ? titleMatch[1].trim() : path.basename(resolvedPath, '.md'));
      }
    } else if (arg.match(/^[0-9a-fA-F]{24}$/)) {
      // It's a MongoDB ID
      profileId = arg;
    } else {
      // Assume it's the agent's name
      agentName = arg;
    }
    
    // If we only have agentName, search in MongoDB
    if (!profileId && agentName) {
      console.log(`Searching database for agentic profile named: "${agentName}"...`);
      // Case insensitive match on name
      const profile = await profileModel.findOne({
        $or: [
          { name: new RegExp('^' + agentName + '$', 'i') },
          { 'agentCard.name': new RegExp('^' + agentName + '$', 'i') }
        ]
      }).exec();
      
      if (profile) {
        profileId = profile._id.toString();
        orgId = profile.orgId;
        console.log(`Found profile: "${profile.name}" (ID: ${profileId}, orgId: ${orgId})`);
      } else {
        console.error(`Error: Could not find any agentic profile in database for name: "${agentName}"`);
        process.exit(1);
      }
    }
    
    if (!profileId) {
      console.error(`Error: Unable to resolve profile ID from input "${arg}"`);
      process.exit(1);
    }
    
    console.log(`Generating full context for profile ID: ${profileId}...`);

    // `--compare` compiles the same profile once per runtime and reports the size of each, which is
    // the measurement task 23 asks for: how much the honest degraded branch costs versus the index
    // that promised tools the reader never had. It is also the quantitative argument for how urgent
    // wiring MCP into the ACP sessions (task 25) really is.
    if (process.argv.includes('--compare')) {
      const runtimes: { label: string; runtime?: any }[] = [
        { label: 'legacy (no runtime declared)', runtime: undefined },
        { label: 'builtin (getSkill + getProfileSource)', runtime: { engine: 'builtin', tools: ['getSkill', 'getProfileSource', 'readFile'] } },
        { label: 'agy in a container (no tools, no wiki on disk)', runtime: { engine: 'agy', tools: [] } },
        { label: 'agy with the wiki mounted', runtime: { engine: 'agy', tools: [], workspaceRoots: [path.resolve(__dirname, '../..')] } },
        { label: 'after task 25 (cm_read over MCP)', runtime: { engine: 'agy', tools: ['cm_read'] } },
      ];
      for (const level of ['basic', 'medium'] as const) {
        console.log(`\n— level ${level.toUpperCase()} —`);
        for (const { label, runtime } of runtimes) {
          const output = await service.composeFullContext(profileId, orgId || undefined, level, runtime);
          console.log(`  ${String(output.length).padStart(7)} chars  ~${String(Math.ceil(output.length / 4)).padStart(6)} tokens   ${label}`);
        }
      }
      console.log('');
    }

    const md = await service.composeFullContext(profileId, orgId || undefined);

    // Save to a local file
    const resolvedName = agentName || 'agent';
    const outputDir = fs.existsSync(resolvedPath) ? path.dirname(resolvedPath) : path.resolve(process.cwd());
    const outputPath = path.join(outputDir, `${resolvedName.toLowerCase()}_compiled_context.md`);
    
    fs.writeFileSync(outputPath, md, 'utf-8');
    console.log('\n====================================');
    console.log(`SUCCESS: Compiled context saved to:`);
    console.log(`${outputPath}`);
    console.log('====================================\n');
  } catch (error) {
    console.error('Error getting profile context:', error);
  } finally {
    await app.close();
  }
}

main();
