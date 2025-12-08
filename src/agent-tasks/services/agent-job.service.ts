import { Injectable } from '@nestjs/common';
import { AgentJobDocument, AgentJobEntity } from '../schemas/agent-job.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FiltersConfig, IQueryResponse, MongoService } from '@dataclouder/nest-mongo';

@Injectable()
export class AgentOutcomeJobService {
  constructor(
    @InjectModel(AgentJobEntity.name)
    public agentJobModel: Model<AgentJobDocument>,
    private mongoService: MongoService
  ) {}

  async create(createJobDto: Partial<AgentJobEntity>): Promise<AgentJobDocument> {
    const createdJob = new this.agentJobModel(createJobDto);
    return createdJob.save();
  }

  async findAll(): Promise<AgentJobDocument[]> {
    return this.agentJobModel.find().exec();
  }

  async findOne(id: string): Promise<AgentJobDocument> {
    return this.agentJobModel.findById(id).exec();
  }

  async update(id: string, updateJobDto: Partial<AgentJobEntity>): Promise<AgentJobDocument> {
    return this.agentJobModel.findByIdAndUpdate(id, updateJobDto, { new: true }).exec();
  }

  async delete(id: string): Promise<AgentJobDocument> {
    return this.agentJobModel.findByIdAndDelete(id).exec();
  }

  // Additional utility methods

  async findByStatus(status: string): Promise<AgentJobDocument[]> {
    return this.agentJobModel.find({ status }).exec();
  }

  async findByAgentId(agentId: string): Promise<AgentJobDocument[]> {
    return this.agentJobModel.find({ agentId }).exec();
  }

  async findByTaskId(taskId: string): Promise<AgentJobDocument[]> {
    return this.agentJobModel.find({ 'task.id': taskId }).exec();
  }

  async findByTaskAttachedIdToday(taskAttachedId: string): Promise<AgentJobDocument[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.agentJobModel.find({ 'task.id': taskAttachedId, createdAt: { $gte: today } }).exec();
  }

  async queryUsingFiltersConfig(filterConfig: FiltersConfig): Promise<IQueryResponse<AgentJobEntity>> {
    return await this.mongoService.queryUsingFiltersConfig(filterConfig, this.agentJobModel);
  }
}
