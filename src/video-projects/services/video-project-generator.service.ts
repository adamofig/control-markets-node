import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoGeneratorEntity, VideoGeneratorDocument } from '../schemas/video-project.entity';
import { CreateVideoGeneratorDto, IVideoProjectGenerator, UpdateVideoGeneratorDto } from '../models/video-project.models';
import { FiltersConfig, flattenObject, IQueryResponse, MongoService } from '@dataclouder/nest-mongo';
import { ObjectId } from 'mongodb';
import { AgentSourcesService } from '../../agent-tasks/services/agent-sources.service';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { CloudStorageService } from '@dataclouder/nest-storage';
import { AppException } from '@dataclouder/nest-core';
@Injectable()
export class VideoGeneratorService extends EntityCommunicationService<VideoGeneratorDocument> {
  constructor(
    @InjectModel(VideoGeneratorEntity.name)
    protected videoGeneratorModel: Model<VideoGeneratorDocument>,
    protected mongoService: MongoService,
    private agentSourceService: AgentSourcesService,
    private agentCardService: AgentCardService,
    protected cloudStorageService: CloudStorageService
  ) {
    super(videoGeneratorModel, mongoService);
  }

  // async create(createVideoGeneratorDto: CreateVideoGeneratorDto): Promise<VideoGeneratorEntity> {
  //   const createdVideoGenerator = new this.videoGeneratorModel(createVideoGeneratorDto);
  //   return await createdVideoGenerator.save();
  // }

  // async queryUsingFiltersConfig(filterConfig: FiltersConfig): Promise<IQueryResponse<VideoGeneratorEntity>> {
  //   return await this.mongoService.queryUsingFiltersConfig(filterConfig, this.videoGeneratorModel);
  // }

  // async findAll(): Promise<VideoGeneratorEntity[]> {
  //   return await this.videoGeneratorModel.find().exec();
  // }

  // async save(videoProject: IVideoProjectGenerator) {
  //   // TODO: test not sure if this is correct
  //   const id = videoProject.id || videoProject['_id'];
  //   if (id) {
  //     return this.update(id, videoProject);
  //   } else {
  //     delete videoProject['_id'];
  //     delete videoProject.id;
  //     const createdVideoGenerator = new this.videoGeneratorModel(videoProject);
  //     return createdVideoGenerator.save();
  //   }
  // }

  // async findOne(id: string): Promise<VideoGeneratorEntity> {
  //   // Tecnica avanzada, es parte de mi estrategia hibrida. todo lo que este dentro de ref va a representar el objecto consultado relacionado.
  //   // interpola el ref con el objecto consultado.
  //   //     "ref": {
  //   //     "_id": "67c7e9c86acc89e9b0842e94",
  //   //     "description": "",
  //   //     "name": "Dwayne Johnson - You're Welcome",
  //   //     "content": "So what I believe\nyou were trying to say is &amp;quot;thank you.&amp;quot; &amp;quot;Thank you&amp;quot;?\nYou&amp;#39;re welcome. What? No, no, no. I-I didn&amp;#39;t...\nI wasn&amp;#39;t... Why would I ever... (chuckling):\nOkay, okay. ♪ I see what&amp;#39;s\nhappening, yeah ♪ ♪ You&amp;#39;re face to face with\ngreatness and it&amp;#39;s strange ♪ ♪ You don&amp;#39;t even\nknow how you feel ♪ ♪ It&amp;#39;s adorable ♪ ♪ Well, it&amp;#39;s nice to see\nthat humans never change ♪ ♪ Open your eyes ♪ (shrieks) ♪ Let&amp;#39;s begin ♪ ♪ Yes, it&amp;#39;s really me ♪ ♪ It&amp;#39;s Maui, breathe it in ♪ ♪ I know it&amp;#39;s a lot ♪ ♪ The hair, the bod ♪ ♪ When you&amp;#39;re staring\nat a demigod ♪ ♪ What can I say except\nyou&amp;#39;re welcome? ♪ ♪ For the tides,\nthe sun, the sky? ♪ ♪ Hey, it&amp;#39;s okay, it&amp;#39;s\nokay-- you&amp;#39;re welcome ♪ ♪ I&amp;#39;m just an\nordinary demi-guy ♪ ♪ Hey, what has two thumbs\nand pulled up the sky ♪ ♪ When you were\nwaddling yea high? ♪ ♪ This guy ♪ ♪ When the nights\ngot cold, who stole ♪ ♪ You fire from down below? ♪ ♪ You&amp;#39;re looking at him, yo ♪ ♪ Oh, also I lassoed the sun ♪ ♪ You&amp;#39;re welcome ♪ ♪ To stretch your days ♪ ♪ And bring you fun ♪ ♪ Also I harnessed the breeze ♪ ♪ You&amp;#39;re welcome ♪ ♪ To fill your sails ♪ ♪ And shake your trees ♪ ♪ So what can I say\nexcept you&amp;#39;re welcome? ♪ ♪ For the islands\nI pulled from the sea ♪ ♪ There&amp;#39;s no need to pray,\nit&amp;#39;s okay, you&amp;#39;re welcome ♪ ♪ Ha, I guess it&amp;#39;s just\nmy way of being me ♪ ♪ You&amp;#39;re welcome!\nYou&amp;#39;re welcome! ♪ ♪ Well, come to think of it... ♪ ♪ Kid, honestly,\nI could go on and on ♪ ♪ I could explain every\nnatural phenomenon ♪ ♪ The tide? The grass?\nThe ground? ♪ ♪ Oh, that was Maui\njust messing around ♪ ♪ I killed an eel,\nI buried its guts ♪ ♪ Sprouted a tree,\nnow you got coconuts ♪ ♪ What&amp;#39;s the lesson?\nWhat is the takeaway? ♪ ♪ Don&amp;#39;t mess with Maui\nwhen he&amp;#39;s on a breakaway ♪ ♪ And the tapestry\nhere in my skin ♪ ♪ Is a map of\nthe victories I win ♪ ♪ Look where I&amp;#39;ve been\nI make everything happen ♪ ♪ Look at that mean mini-Maui\njust tickety-tappin&amp;#39;! ♪ ♪ Heh heh heh heh heh heh hey! ♪ ♪ Well, anyway, let me say ♪ ♪ You&amp;#39;re welcome ♪ ♪ &lt;font color=&quot;#FFFFFF&quot;&gt;&lt;i&gt;You&amp;#39;re welcome&lt;/i&gt; ♪&lt;/font&gt; ♪ For the wonderful\nworld you know ♪ ♪ Hey, it&amp;#39;s okay, it&amp;#39;s okay ♪ ♪ You&amp;#39;re welcome ♪ ♪ &lt;font color=&quot;#FFFFFF&quot;&gt;&lt;i&gt;You&amp;#39;re welcome&lt;/i&gt; ♪&lt;/font&gt; ♪ Well, come to think\nof it, I gotta go ♪ ♪ Hey, it&amp;#39;s your day to say ♪ ♪ You&amp;#39;re welcome ♪ ♪ &lt;font color=&quot;#FFFFFF&quot;&gt;&lt;i&gt;You&amp;#39;re welcome&lt;/i&gt; ♪&lt;/font&gt; ♪ &amp;#39;Cause I&amp;#39;m gonna\nneed that boat ♪ ♪ I&amp;#39;m sailing away, away ♪ ♪ You&amp;#39;re welcome ♪ ♪ &lt;font color=&quot;#FFFFFF&quot;&gt;&lt;i&gt;You&amp;#39;re welcome&lt;/i&gt; ♪&lt;/font&gt; ♪ &amp;#39;Cause Maui can do\neverything but float ♪ ♪ &lt;font color=&quot;#FFFFFF&quot;&gt;&lt;i&gt;You&amp;#39;re welcome&lt;/i&gt; ♪&lt;/font&gt; ♪ You&amp;#39;re welcome ♪ ♪ &lt;font color=&quot;#FFFFFF&quot;&gt;&lt;i&gt;You&amp;#39;re welcome&lt;/i&gt; ♪&lt;/font&gt; ♪ You&amp;#39;re welcome! ♪ Huh? And thank you! Hey!"
  //   // }

  //   return await this.videoGeneratorModel
  //     .findById(id)
  //     .populate({
  //       path: 'sources.reference',
  //       model: 'AgentSourceEntity',
  //       select: 'name description content type video thumbnail',
  //     })
  //     .exec();
  // }

  // Implementar el otro método update solo lo que le mando. y ver como estandarizar.
  // async update(id: string, updateVideoGeneratorDto: UpdateVideoGeneratorDto): Promise<VideoGeneratorEntity> {
  //   console.log(id, updateVideoGeneratorDto);
  //   // by default update only updates what is present in updateObject
  //   return await this.videoGeneratorModel.findByIdAndUpdate(id, updateVideoGeneratorDto, { new: true }).exec();
  // }

  /**
   * Updates only the properties that are present in the update object
   * @param id The ID of the entity to update
   * @param partialUpdates Object containing only the properties to update
   * @returns The updated entity
   */
  async partialUpdateFlattend(id: string, partialUpdates: Partial<IVideoProjectGenerator>): Promise<VideoGeneratorEntity> {
    // Convert nested objects to dot notation eg. { "video.captions.remotion": captions.captions }
    // This way you can only remove properties that are present in the update object
    const flattenedUpdates = flattenObject(partialUpdates);
    return await this.videoGeneratorModel.findByIdAndUpdate(id, { $set: flattenedUpdates }, { new: true }).exec();
  }

  async remove(id: string): Promise<void> {
    await this.videoGeneratorModel.findByIdAndDelete(id).exec();
  }

  async addSourceToVideoProject(videoProjectId: string, sourceId: string) {
    // According to hibrid relation strategy, save basic info including id, so i can remove it later
    const videoProject = await this.agentSourceService.findOne(sourceId, { _id: 0, id: 1, name: 1, description: 1, thumbnail: 1 });
    if (!videoProject) {
      throw new AppException({ error_message: 'Source not found', statusCode: 404 });
    }
    console.log(videoProject);

    const newSourceReference = { reference: new ObjectId(sourceId), ...videoProject };
    return this.videoGeneratorModel.findByIdAndUpdate(videoProjectId, { $addToSet: { sources: newSourceReference } }, { new: true });
  }

  async addAgentCardToVideoProject(videoProjectId: string, agentCardId: string) {
    // According to hibrid relation strategy, save basic info including id, so i can remove it later
    const videoProject = await this.agentCardService.findOne(agentCardId, { _id: 0, id: 1, title: 1, assets: 1 });
    if (!videoProject) {
      throw new AppException({ error_message: 'Agent card not found', statusCode: 404 });
    }
    console.log(videoProject);

    const newAgentCardReference = { reference: new ObjectId(agentCardId), ...videoProject };
    return this.videoGeneratorModel.findByIdAndUpdate(videoProjectId, { $set: { agent: newAgentCardReference } }, { new: true });
  }

  async removeSourceFromVideoProject(videoProjectId: string, sourceId: string) {
    return this.videoGeneratorModel.findByIdAndUpdate(videoProjectId, { $pull: { sources: { id: sourceId } } }, { new: true });
  }
}
