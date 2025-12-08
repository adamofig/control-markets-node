import { Injectable, Logger } from '@nestjs/common';
import { AgentOutcomeJobService } from './agent-job.service';
import { IAgentOutcomeJob } from '../models/classes';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class AgentDistributionChannelService {
  private readonly logger = new Logger(AgentDistributionChannelService.name);
  private readonly astroBlogPostsPath = '/Users/adamo/Documents/GitHub/blog/polilan-blog/src/content/posts/';

  constructor(private readonly agentJobService: AgentOutcomeJobService) {}

  private slugify(text: string): string {
    if (!text) return 'untitled-post';
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with -
      .replace(/[^\w-]+/g, '') // Remove all non-word chars
      .replace(/--+/g, '-'); // Replace multiple - with single -
  }

  async postToBlog(jobId: string) {
    // Added jobId parameter
    this.logger.log(`Attempting to post job [${jobId}] to Astro blog.`);
    let job: IAgentOutcomeJob;
    try {
      job = await this.agentJobService.findOne(jobId); // Use the passed jobId
      if (!job) {
        this.logger.error(`Job with ID [${jobId}] not found.`);
        return { success: false, message: `Job with ID [${jobId}] not found.` };
      }
      this.logger.log(`Job [${jobId}] fetched successfully.`);
    } catch (error) {
      this.logger.error(`Error fetching job [${jobId}]: ${error.message}`, error.stack);
      return { success: false, message: `Error fetching job: ${error.message}` };
    }

    const title = job.result?.title;
    const content = job.result?.content;

    if (!title || typeof title !== 'string') {
      this.logger.error(`Job [${jobId}] task is missing a valid name (for title).`);
      return { success: false, message: 'Job task is missing a valid name (for title).' };
    }
    if (!content || typeof content !== 'string') {
      this.logger.error(`Job [${jobId}] response is missing valid content.`);
      return { success: false, message: 'Job response is missing valid content.' };
    }

    const slug = this.slugify(title);
    const filename = `${slug}.md`;
    const filePath = path.join(this.astroBlogPostsPath, filename);

    this.logger.log(`Generated filename: ${filename} for job [${jobId}].`);
    this.logger.log(`Target file path: ${filePath}`);

    try {
      // Ensure the directory exists (optional, fs.writeFile creates dirs if recursive option is true in some versions, but explicit is safer)
      // For fs/promises, direct directory creation isn't part of writeFile.
      // await fs.mkdir(this.astroBlogPostsPath, { recursive: true }); // Uncomment if directory might not exist

      await fs.writeFile(filePath, content, 'utf8');
      this.logger.log(`Successfully wrote blog post to ${filePath} for job [${jobId}].`);
      return { success: true, path: filePath, message: 'Blog post created successfully.' };
    } catch (error) {
      this.logger.error(`Error writing file to ${filePath} for job [${jobId}]: ${error.message}`, error.stack);
      return { success: false, message: `Error writing file: ${error.message}` };
    }
  }
}
