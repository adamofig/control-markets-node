import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeckCommanderService } from '../services/deck-commander.service';
import * as notifier from 'node-notifier';
import { exec } from 'child_process';

import { EntityController } from '@dataclouder/nest-mongo';
import { DeckCommanderDocument } from '../schemas/deck-commander.schema';

@ApiTags('DeckCommander')
@Controller('api/DeckCommander') // NOT ENDPOINT Father will tell
export class DeckCommanderController extends EntityController<DeckCommanderDocument> {
  constructor(private readonly DeckCommanderService: DeckCommanderService) {
    super(DeckCommanderService);
  }

  @Post('/execute')
  @ApiOperation({ summary: 'Execute a DeckCommander', description: 'Execute a DeckCommander' })
  async execute(@Body() body: { command?: string }): Promise<any> {
    const { command } = body;

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
