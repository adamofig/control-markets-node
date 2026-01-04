import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { FlowExecutionStateDocument, FlowExecutionStateEntity } from '../schemas/flow-execution-state.schema';

@Injectable()
export class FlowExecutionStateService extends EntityCommunicationService<FlowExecutionStateDocument> {
  private logger = new Logger(FlowExecutionStateService.name);

  constructor(
    @InjectModel(FlowExecutionStateEntity.name)
    protected flowExecutionStateModel: Model<FlowExecutionStateDocument>,
    protected mongoService: MongoService,
    protected cloudStorageService: CloudStorageService
  ) {
    super(flowExecutionStateModel, mongoService);
  }
}
