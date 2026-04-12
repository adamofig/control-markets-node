import { Injectable } from '@nestjs/common';
import { AgentJobDocument, AgentJobEntity } from '../schemas/agent-job.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';

@Injectable()
export class AgentOutcomeJobService extends EntityCommunicationService<AgentJobDocument> {
  constructor(
    @InjectModel(AgentJobEntity.name)
    agentJobModel: Model<AgentJobDocument>,
    mongoService: MongoService
  ) {
    super(agentJobModel, mongoService);
  }

  async findByStatus(status: string): Promise<AgentJobDocument[]> {
    return this.genericModel.find({ status }).exec();
  }

  async findByAgentId(agentId: string): Promise<AgentJobDocument[]> {
    return this.genericModel.find({ agentId }).exec();
  }

  async findByTaskId(taskId: string): Promise<AgentJobDocument[]> {
    return this.genericModel.find({ 'task.id': taskId }).exec();
  }

  async findByTaskAttachedIdToday(taskAttachedId: string): Promise<AgentJobDocument[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.genericModel.find({ 'task.id': taskAttachedId, createdAt: { $gte: today } }).exec();
  }
}
