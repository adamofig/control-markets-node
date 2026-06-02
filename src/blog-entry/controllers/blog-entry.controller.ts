import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BlogEntryService } from '../services/blog-entry.service';
import { EntityMongoController } from '@dataclouder/nest-mongo';
import { BlogEntryDocument } from '../schemas/blog-entry.schema';
import { DecodedToken } from '@dataclouder/nest-auth';

@ApiTags('blog-entry')
@Controller('api/blog-entry')
export class BlogEntryController extends EntityMongoController<BlogEntryDocument> {
  constructor(private readonly blogEntryService: BlogEntryService) {
    super(blogEntryService);
  }

  // Intercept standard CRUD operations to keep filesystem sync updated
  @Post('operation')
  override async executeOperation(@Body() body: any, @DecodedToken() token: any) {
    const result = await super.executeOperation(body, token);

    if (!result) return result;

    // Trigger local filesystem writes/deletes based on standard operations
    if (body.action === 'create' || body.action === 'updateOne') {
      let doc = Array.isArray(result) ? result[0] : result;
      if (body.action === 'updateOne') {
        const query = body.query || {};
        const id = query._id || (body.payload && (body.payload._id || body.payload.id));
        if (id) {
          doc = await this.blogEntryService.findOne(id);
        }
      }
      if (doc && doc.slug) {
        await this.blogEntryService.writePostToFile(doc);
      }
    } else if (body.action === 'deleteOne') {
      // Find the slug from query before deleting, or if query is an ID
      const query = body.query || {};
      let slug = query.slug;
      if (!slug && query._id) {
        const doc = await this.blogEntryService.findOne(query._id);
        if (doc) slug = doc.slug;
      }
      if (slug) {
        await this.blogEntryService.deletePostFile(slug);
      }
    }

    return result;
  }

  // Sync existing markdown posts into MongoDB
  @Post('sync-from-files')
  async syncFromFiles(@Body() body: { orgId?: string }) {
    return await this.blogEntryService.syncFilesToDatabase(body.orgId);
  }

  // Sync posts from GitHub (Remote Sync for Production)
  @Post('sync-from-github')
  async syncFromGithub(@Body() body: { orgId?: string }) {
    return await this.blogEntryService.syncFromGithub(body.orgId);
  }

  // Push post directly to GitHub repository using REST API
  @Post('push-to-github')
  async pushToGithub(@Body() body: { id: string }) {
    return await this.blogEntryService.pushPostToGithub(body.id);
  }

  // Test connection to GitHub repository
  @Post('test-github-connection')
  async testGithubConnection(@Body() body: { githubRepo: string; postPath: string }) {
    return await this.blogEntryService.testGithubConnection(body.githubRepo, body.postPath);
  }
}
