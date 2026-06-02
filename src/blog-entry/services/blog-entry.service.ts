import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlogEntryEntity, BlogEntryDocument } from '../schemas/blog-entry.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import axios from 'axios';
import { OrganizationService } from '../../organization/services/organization.service';

@Injectable()
export class BlogEntryService extends EntityCommunicationService<BlogEntryDocument> {
  private readonly logger = new Logger(BlogEntryService.name);
  
  // Resolve paths dynamically based on local filesystem workspace
  private readonly workspaceBlogPostsPath = '/Users/adamo/Documents/GitHub/control-markets/polilan-blog/src/content/posts';
  private readonly fallbackBlogPostsPath = '/Users/adamo/Documents/GitHub/blog/polilan-blog/src/content/posts';

  constructor(
    @InjectModel(BlogEntryEntity.name)
    blogEntryModel: Model<BlogEntryDocument>,
    mongoService: MongoService,
    private readonly organizationService: OrganizationService,
  ) {
    super(blogEntryModel, mongoService);
  }

  // Sanitize operation payloads to avoid Date casting errors from empty objects
  override async executeOperation(operation: any): Promise<any> {
    if (operation && operation.payload) {
      const payload = operation.payload;
      
      if (payload.published) {
        if (typeof payload.published === 'object' && Object.keys(payload.published).length === 0) {
          payload.published = new Date();
        } else if (isNaN(new Date(payload.published).getTime())) {
          payload.published = new Date();
        }
      }
      
      if (payload.updated) {
        if (typeof payload.updated === 'object' && Object.keys(payload.updated).length === 0) {
          payload.updated = new Date();
        } else if (isNaN(new Date(payload.updated).getTime())) {
          payload.updated = new Date();
        }
      }
    }
    return super.executeOperation(operation);
  }

  private getPostsDirectory(): string {
    if (existsSync(this.workspaceBlogPostsPath)) {
      return this.workspaceBlogPostsPath;
    }
    return this.fallbackBlogPostsPath;
  }

  // Generate a URL friendly slug
  private generateSlug(name: string): string {
    if (!name || !name.trim()) {
      return `post-${Date.now()}`;
    }
    return name
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .replace(/[\s_]+/g, '-') // spaces to hyphen
      .replace(/-+/g, '-'); // collapse multiple hyphens
  }

  // Generate markdown with YAML frontmatter conforming to Astro collection schema
  private serializeMarkdown(post: BlogEntryEntity): string {
    const pubDate = post.published ? new Date(post.published).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const tagsStr = post.tags && post.tags.length ? `[${post.tags.map(t => `"${t}"`).join(', ')}]` : '[]';
    
    return `---
title: "${(post.name || '').replace(/"/g, '\\"')}"
published: ${pubDate}
description: "${(post.description || '').replace(/"/g, '\\"')}"
tags: ${tagsStr}
category: "${post.category || 'Tecnología'}"
draft: ${!!post.draft}
lang: "${post.lang || 'es'}"
---

${post.content || ''}
`;
  }

  // Parse markdown file with YAML frontmatter
  private parseMarkdown(filename: string, fileContent: string): Partial<BlogEntryEntity> {
    const slug = filename.replace(/\.md$/, '');
    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    
    if (!match) {
      return { slug, name: slug, content: fileContent, published: new Date(), draft: false, tags: [] };
    }

    const frontmatterText = match[1];
    const content = match[2].trim();
    
    const lines = frontmatterText.split('\n');
    const meta: any = { slug, content, tags: [] };
    
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      
      // Strip quotes
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      
      if (key === 'title') {
        meta.name = val;
      } else if (key === 'published') {
        meta.published = new Date(val);
      } else if (key === 'description') {
        meta.description = val;
      } else if (key === 'category') {
        meta.category = val;
      } else if (key === 'lang') {
        meta.lang = val;
      } else if (key === 'draft') {
        meta.draft = val === 'true';
      } else if (key === 'tags') {
        meta.tags = val
          .replace(/[\[\]]/g, '')
          .split(',')
          .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
          .filter(t => t);
      }
    }
    
    // Set default values if fields are missing
    if (!meta.name) meta.name = slug;
    if (!meta.published || isNaN(meta.published.getTime())) meta.published = new Date();
    
    return meta;
  }

  // Write a single post record to its corresponding Markdown file in the Astro project
  async writePostToFile(post: BlogEntryEntity): Promise<string> {
    const postsDir = this.getPostsDirectory();
    if (!post.slug || !post.slug.trim()) {
      post.slug = this.generateSlug(post.name);
      if ((post as any)._id) {
        await this.genericModel.updateOne({ _id: (post as any)._id }, { $set: { slug: post.slug } });
      }
    }
    const filename = `${post.slug}.md`;
    const filePath = path.join(postsDir, filename);
    const content = this.serializeMarkdown(post);
    
    await fs.mkdir(postsDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    this.logger.log(`Successfully wrote blog entry file to: ${filePath}`);
    return filePath;
  }

  // Delete local file if post is deleted
  async deletePostFile(slug: string): Promise<void> {
    const postsDir = this.getPostsDirectory();
    const filePath = path.join(postsDir, `${slug}.md`);
    try {
      if (existsSync(filePath)) {
        await fs.unlink(filePath);
        this.logger.log(`Deleted blog entry file: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting file ${filePath}: ${error.message}`);
    }
  }

  // Sync filesystem posts to MongoDB (Import / Bidirectional Sync)
  async syncFilesToDatabase(orgId?: string): Promise<{ imported: number; updated: number }> {
    const postsDir = this.getPostsDirectory();
    this.logger.log(`Starting filesystem sync from directory: ${postsDir}`);
    
    if (!existsSync(postsDir)) {
      this.logger.warn(`Blog posts directory does not exist: ${postsDir}`);
      return { imported: 0, updated: 0 };
    }

    const files = await fs.readdir(postsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    let imported = 0;
    let updated = 0;

    for (const filename of mdFiles) {
      const filePath = path.join(postsDir, filename);
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = this.parseMarkdown(filename, fileContent);
      
      // Look up by slug
      const existing = await this.genericModel.findOne({ slug: parsed.slug });
      
      if (existing) {
        // If content or name changed, update MongoDB representation
        if (existing.content !== parsed.content || existing.name !== parsed.name || existing.draft !== parsed.draft) {
          await this.genericModel.updateOne(
            { _id: existing._id },
            { 
              $set: { 
                ...parsed,
                orgId: existing.orgId || orgId // keep original orgId if set
              } 
            }
          );
          updated++;
        }
      } else {
        // Create new record
        await this.genericModel.create({
          ...parsed,
          orgId: orgId || null,
          filePath: `src/content/posts/${filename}`
        });
        imported++;
      }
    }
    
    return { imported, updated };
  }

  // Helper to resolve github repository config for an organization
  private async resolveGithubConfig(orgId?: string): Promise<{ owner: string; repo: string; postPath: string }> {
    let owner = 'adamofig';
    let repo = 'polilan-blog';
    let postPath = 'src/content/posts';

    if (orgId) {
      try {
        const org = await this.organizationService.findOne(orgId);
        if (org && org.blog) {
          if (org.blog.githubRepo) {
            let cleanRepo = org.blog.githubRepo.trim();
            cleanRepo = cleanRepo.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
            cleanRepo = cleanRepo.replace(/\.git$/i, '');
            cleanRepo = cleanRepo.replace(/^\/+|\/+$/g, '');
            
            const parts = cleanRepo.split('/');
            if (parts.length === 2) {
              owner = parts[0].trim();
              repo = parts[1].trim();
            }
          }
          if (org.blog.postPath) {
            postPath = org.blog.postPath.trim().replace(/^\/+|\/+$/g, '');
          }
        }
      } catch (err: any) {
        this.logger.error(`Error loading organization config for github: ${err.message}`);
      }
    }

    return { owner, repo, postPath };
  }

  // Push post directly to GitHub repository using GitHub REST API
  async pushPostToGithub(id: string): Promise<{ success: boolean; message: string }> {
    const post = await this.findOne(id);
    if (!post) {
      throw new Error(`Entrada de blog con ID ${id} no encontrada.`);
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN no está configurado en el archivo .env del backend.');
    }

    if (!post.slug || !post.slug.trim()) {
      post.slug = this.generateSlug(post.name);
      await this.genericModel.updateOne({ _id: (post as any)._id }, { $set: { slug: post.slug } });
    }

    const markdownContent = this.serializeMarkdown(post);
    const contentBase64 = Buffer.from(markdownContent, 'utf8').toString('base64');
    
    const { owner, repo, postPath } = await this.resolveGithubConfig(post.orgId);
    const filePath = `${postPath}/${post.slug}.md`;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    let sha: string | undefined;

    // 1. Check if the file already exists on GitHub to obtain its blob SHA
    try {
      const response = await axios.get(url, { headers });
      if (response.data && response.data.sha) {
        sha = response.data.sha;
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        this.logger.log(`File ${filePath} does not exist on GitHub yet. Creating new file.`);
      } else {
        const errMsg = error.response?.data?.message || error.message;
        this.logger.error(`Error checking file existence on GitHub: ${errMsg}`);
        throw new Error(`Error al verificar existencia en GitHub: ${errMsg}`);
      }
    }

    // 2. Perform PUT to create or update the file content
    try {
      const body = {
        message: `feat(blog): publish/update ${post.name}`,
        content: contentBase64,
        ...(sha ? { sha } : {}),
      };

      const putRes = await axios.put(url, body, { headers });
      const newSha = putRes.data?.content?.sha;
      if (newSha) {
        await this.genericModel.updateOne({ _id: (post as any)._id }, { $set: { githubSha: newSha } });
      }

      this.logger.log(`Successfully pushed post "${post.name}" to GitHub repository ${owner}/${repo}`);
      return { success: true, message: `Entrada "${post.name}" publicada/actualizada con éxito en GitHub.` };
    } catch (error: any) {
      const errMsg = error.response?.data?.message || error.message;
      this.logger.error(`Error writing file content to GitHub: ${errMsg}`);
      throw new Error(`Error al subir archivo a GitHub: ${errMsg}`);
    }
  }

  // Sync posts from GitHub (Remote Sync for Production)
  async syncFromGithub(orgId?: string): Promise<{ imported: number; updated: number; deleted: number }> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN no está configurado en el archivo .env del backend.');
    }

    const { owner, repo, postPath } = await this.resolveGithubConfig(orgId);
    this.logger.log(`Starting remote sync from GitHub: ${owner}/${repo} at ${postPath}`);

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${postPath}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    let files: any[] = [];
    try {
      const response = await axios.get(url, { headers });
      if (Array.isArray(response.data)) {
        files = response.data;
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        this.logger.warn(`Blog posts directory does not exist on GitHub: ${postPath}`);
        return { imported: 0, updated: 0, deleted: 0 };
      }
      const errMsg = error.response?.data?.message || error.message;
      this.logger.error(`Error reading directory from GitHub: ${errMsg}`);
      throw new Error(`Error al leer repositorio de GitHub: ${errMsg}`);
    }

    const mdFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.md'));
    
    let imported = 0;
    let updated = 0;
    let deleted = 0;

    const githubSlugs = new Set<string>();

    for (const file of mdFiles) {
      const slug = file.name.replace(/\.md$/, '');
      githubSlugs.add(slug);

      // Look up existing by slug & orgId
      const existing = await this.genericModel.findOne({ slug, orgId: orgId || null });

      if (existing) {
        // Skip if githubSha matches
        if (existing.githubSha === file.sha) {
          continue;
        }

        // Fetch file contents
        try {
          const fileRes = await axios.get(file.url, { headers });
          if (fileRes.data && fileRes.data.content) {
            const rawContent = Buffer.from(fileRes.data.content, 'base64').toString('utf8');
            const parsed = this.parseMarkdown(file.name, rawContent);
            
            await this.genericModel.updateOne(
              { _id: existing._id },
              { 
                $set: { 
                  ...parsed,
                  githubSha: file.sha,
                  filePath: `${postPath}/${file.name}`
                } 
              }
            );
            updated++;
          }
        } catch (err: any) {
          this.logger.error(`Error fetching file content for ${file.name} from GitHub: ${err.message}`);
        }
      } else {
        // Create new record
        try {
          const fileRes = await axios.get(file.url, { headers });
          if (fileRes.data && fileRes.data.content) {
            const rawContent = Buffer.from(fileRes.data.content, 'base64').toString('utf8');
            const parsed = this.parseMarkdown(file.name, rawContent);
            
            await this.genericModel.create({
              ...parsed,
              orgId: orgId || null,
              githubSha: file.sha,
              filePath: `${postPath}/${file.name}`
            });
            imported++;
          }
        } catch (err: any) {
          this.logger.error(`Error fetching file content for ${file.name} from GitHub: ${err.message}`);
        }
      }
    }

    // Sync deletions: Find local entries that were synced (have a githubSha) but are not in the GitHub list
    const localSyncedEntries = await this.genericModel.find({
      orgId: orgId || null,
      githubSha: { $exists: true, $ne: null }
    });

    for (const entry of localSyncedEntries) {
      if (!githubSlugs.has(entry.slug)) {
        await this.genericModel.deleteOne({ _id: entry._id });
        deleted++;
      }
    }

    return { imported, updated, deleted };
  }

  // Test connection to a GitHub repository and path
  async testGithubConnection(githubRepo: string, postPath: string): Promise<{ success: boolean; message: string }> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN no está configurado en el archivo .env del backend.');
    }

    if (!githubRepo || !githubRepo.trim()) {
      throw new Error('El repositorio de GitHub es requerido.');
    }

    let cleanRepo = githubRepo.trim();
    cleanRepo = cleanRepo.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
    cleanRepo = cleanRepo.replace(/\.git$/i, '');
    cleanRepo = cleanRepo.replace(/^\/+|\/+$/g, '');
    
    const parts = cleanRepo.split('/');
    if (parts.length !== 2) {
      throw new Error('Formato de repositorio inválido. Debe ser propietario/repositorio.');
    }

    const owner = parts[0].trim();
    const repo = parts[1].trim();
    const cleanPath = (postPath || 'src/content/posts').trim().replace(/^\/+|\/+$/g, '');

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // 1. Test repository accessibility
    try {
      await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    } catch (error: any) {
      const errMsg = error.response?.data?.message || error.message;
      throw new Error(`Repositorio inaccesible o no existe: ${errMsg}`);
    }

    // 2. Test directory path exists
    try {
      const pathUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`;
      await axios.get(pathUrl, { headers });
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        throw new Error(`La ruta de posts "${cleanPath}" no existe en el repositorio.`);
      }
      const errMsg = error.response?.data?.message || error.message;
      throw new Error(`Error al validar la ruta de posts: ${errMsg}`);
    }

    return { success: true, message: 'Conexión con GitHub verificada con éxito.' };
  }
}
