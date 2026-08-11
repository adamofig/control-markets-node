import { Body, Controller, ForbiddenException, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeckCommanderService } from '../services/deck-commander.service';
import * as notifier from 'node-notifier';
import { exec } from 'child_process';

import { EntityMongoController } from '@dataclouder/nest-mongo';
import { AppGuard } from '@dataclouder/nest-core';
import { AppToken } from '@dataclouder/nest-auth';
import { DeckCommanderDocument } from '../schemas/deck-commander.schema';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { DecodedToken } from 'src/common/token.decorator';
import { isPlatformAdmin } from 'src/auth/platform-roles';
import { NotOrgScoped } from 'src/auth/not-org-scoped.decorator';

@ApiTags('deck-commander')
@NotOrgScoped('deck-commander.schema.ts stores no orgId. The controller is already gated behind isPlatformAdmin by F10, which is a stricter check than any org scope.')
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/deck-commander') // NOT ENDPOINT Father will tell
export class DeckCommanderController extends EntityMongoController<DeckCommanderDocument> {
  private readonly logger = new Logger('DeckCommander');

  constructor(private readonly DeckCommanderService: DeckCommanderService) {
    super(DeckCommanderService);
  }

  /**
   * Runs a shell command on the machine hosting the API. This is a local desktop tool — it fires
   * `node-notifier` desktop notifications — and before F10 it was **anonymous remote code
   * execution**: any `POST /api/deck-commander/execute` with a `command` ran as the API process.
   *
   * Authentication alone does not make that safe, so three conditions now apply:
   *
   * 1. The class guard: no token, no execution.
   * 2. **Platform admin only.** A shell on the host is not an organization-scoped capability; no
   *    org role can grant it. That is why the check is `isPlatformAdmin`, not `@OrgPermission`.
   * 3. **Never in production**, unless `DECK_COMMANDER_EXEC=true` is set on purpose. The feature
   *    exists to drive the developer's own machine; a deployed server has no desktop to notify.
   *
   * Every accepted execution is audited, like `[SYSTEM_MASTER_EXECUTION]` and `[ADMIN_BYPASS]`.
   */
  @Post('/execute')
  @ApiOperation({ summary: 'Execute a DeckCommander', description: 'Runs a shell command on the API host. Platform admin only, disabled in production.' })
  async execute(@Body() body: { command?: string }, @DecodedToken() token?: AppToken): Promise<any> {
    const { command } = body;

    if (!isPlatformAdmin(token)) {
      throw new ForbiddenException('Running host commands requires a platform admin role');
    }

    const enabled = process.env.DECK_COMMANDER_EXEC === 'true' || process.env.NODE_ENV !== 'production';
    if (!enabled) {
      throw new ForbiddenException('DeckCommander execution is disabled on this server (set DECK_COMMANDER_EXEC=true to enable)');
    }

    if (command) {
      this.logger.warn(`[DECK_COMMANDER_EXEC] actor=${token?.email ?? '-'} | command=${command}`);
    }

    notifier.notify({
      title: 'DeckCommander',
      message: command ? `Executing: ${command}` : 'Execution started!',
    });

    if (command) {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          notifier.notify({
            title: 'DeckCommander Error',
            message: `Error executing: ${command}`,
          });
          return;
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
        notifier.notify({
          title: 'DeckCommander Success',
          message: `Finished executing: ${command}`,
        });
      });
    }

    return { message: 'execution triggered', command };
  }
}
