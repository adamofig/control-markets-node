import { Module } from '@nestjs/common';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgenticProfileModule } from '../agentic-profile/agentic-profile.module';
import { AgentsModule } from '../agent-tasks/agent-tasks.module';
import { MentionsController } from './mentions.controller';
import { MentionsService } from './mentions.service';
import { MENTION_RESOLVERS } from './models/mention.models';
import { AgenticProfileMentionResolver } from './resolvers/agentic-profile.resolver';
import { OrgSourceMentionResolver } from './resolvers/org-source.resolver';
import { ProfileLinkedMentionResolver } from './resolvers/profile-linked.resolver';

/**
 * The universal `@mention` system.
 *
 * **Adding a resource family is a change to this file and one new resolver — nothing else.** Write
 * an `IMentionResolver`, add it to `providers` and to the `MENTION_RESOLVERS` factory, and the
 * catalog, the search endpoint, the turn resolution and the prompt block pick it up. That is the
 * whole reason the registry exists: `storage_assets`, `channel_identities` and `blog_entries` must
 * not each reopen the chat pipeline.
 *
 * The order of the factory array is the tie-break order when two collections answer for the same id.
 */
@Module({
  imports: [NestAuthModule, AgenticProfileModule, AgentsModule],
  controllers: [MentionsController],
  providers: [
    ProfileLinkedMentionResolver,
    OrgSourceMentionResolver,
    AgenticProfileMentionResolver,
    {
      provide: MENTION_RESOLVERS,
      useFactory: (sources: OrgSourceMentionResolver, profiles: AgenticProfileMentionResolver) => [sources, profiles],
      inject: [OrgSourceMentionResolver, AgenticProfileMentionResolver],
    },
    MentionsService,
  ],
  exports: [MentionsService],
})
export class MentionsModule {}
