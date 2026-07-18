import { Module } from '@nestjs/common';
import { WikiWriteBackService } from './wiki-write-back.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';

/**
 * Phase 2 of the wiki sync: local write-back (DB → `.md`).
 * Leaf module — listens to `wiki.task.changed` / `wiki.source.changed` events so the
 * business services never touch the filesystem themselves. Only acts when
 * WIKI_LOCAL_WRITE=true and NODE_ENV !== 'production'.
 */
@Module({
  imports: [WorkspacesModule, AgentsModule, AgenticProfileModule],
  providers: [WikiWriteBackService],
})
export class WikiSyncModule {}
