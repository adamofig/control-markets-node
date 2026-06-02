import { IAuditable } from '@dataclouder/nest-core';

export interface IBlogEntry {
  _id?: string;
  id?: string;
  orgId?: string;
  name: string;
  slug: string;
  published: Date;
  updated?: Date;
  draft: boolean;
  description: string;
  image?: string; // Standard image path or relative reference
  tags: string[];
  category: string;
  lang: string;
  content: string; // Markdown body text
  filePath?: string; // Relative path, e.g. 'src/content/posts/my-post.md'
  githubSha?: string;
  auditable?: IAuditable;
}
