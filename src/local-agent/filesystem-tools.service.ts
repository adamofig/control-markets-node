import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as fg from 'fast-glob';

const MAX_READ_BYTES = 100_000;
const MAX_READ_LINES = 2000;
const DENY_PATTERNS = [/\.env/i, /node_modules/, /\.git\//, /secret/i, /credential/i, /\.pem$/i, /\.key$/i];

@Injectable()
export class FilesystemToolsService {
  get enabled(): boolean {
    return process.env.LOCAL_AGENT_MODE === 'true';
  }

  get workspaceRoots(): string[] {
    return (process.env.LOCAL_AGENT_WORKSPACE_ROOTS ?? '')
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);
  }

  /** Resolves a path and ensures it lives inside one of the workspace roots and is not deny-listed. */
  private async resolveSafe(inputPath: string, forWrite = false): Promise<string> {
    const roots = this.workspaceRoots;
    if (roots.length === 0) throw new Error('No LOCAL_AGENT_WORKSPACE_ROOTS configured.');

    const abs = path.resolve(inputPath);
    if (DENY_PATTERNS.some(p => p.test(abs))) {
      throw new Error(`Access denied: path matches a protected pattern (${inputPath}).`);
    }

    // For writes the file may not exist yet: realpath the deepest existing ancestor to block symlink escapes.
    let checkTarget = abs;
    if (forWrite) {
      let dir = path.dirname(abs);
      while (!(await fs.stat(dir).catch(() => null))) dir = path.dirname(dir);
      checkTarget = path.join(await fs.realpath(dir), path.relative(dir, abs));
    } else {
      checkTarget = await fs.realpath(abs).catch(() => abs);
    }

    const inside = roots.some(root => checkTarget === root || checkTarget.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
    if (!inside) {
      throw new Error(`Access denied: ${inputPath} is outside the allowed workspace roots.`);
    }
    return abs;
  }

  /** Sandboxed read for external engines (e.g. the ACP bridge fs/read_text_file delegation). */
  async readTextFileSafe(filePath: string, line?: number, limit?: number): Promise<string> {
    const safe = await this.resolveSafe(filePath);
    const raw = await fs.readFile(safe, 'utf-8');
    if (line == null && limit == null) return raw;
    const lines = raw.split('\n');
    const start = Math.max((line ?? 1) - 1, 0);
    return lines.slice(start, limit != null ? start + limit : undefined).join('\n');
  }

  /** Sandboxed write for external engines (e.g. the ACP bridge fs/write_text_file delegation). */
  async writeTextFileSafe(filePath: string, content: string): Promise<void> {
    const safe = await this.resolveSafe(filePath, true);
    await fs.mkdir(path.dirname(safe), { recursive: true });
    await fs.writeFile(safe, content, 'utf-8');
  }

  /** Builds the tools object for the Vercel AI SDK streamText loop. */
  buildTools(): Record<string, any> {
    if (!this.enabled) return {};

    return {
      readFile: tool({
        description: 'Read a text file from the local workspace. Returns the content with line numbers. Use offset/limit for large files.',
        inputSchema: z.object({
          path: z.string().describe('Absolute path of the file to read.'),
          offset: z.number().optional().describe('1-based line number to start reading from.'),
          limit: z.number().optional().describe('Max number of lines to return (default 2000).'),
        }),
        execute: async ({ path: filePath, offset, limit }) => {
          const safe = await this.resolveSafe(filePath);
          const raw = await fs.readFile(safe, 'utf-8');
          if (raw.length > MAX_READ_BYTES * 5) throw new Error('File too large to read entirely; use offset/limit.');
          const lines = raw.split('\n');
          const start = Math.max((offset ?? 1) - 1, 0);
          const slice = lines.slice(start, start + Math.min(limit ?? MAX_READ_LINES, MAX_READ_LINES));
          return { path: safe, totalLines: lines.length, content: slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n') };
        },
      }),

      writeFile: tool({
        description: 'Create or overwrite a text file in the local workspace. Parent directories are created automatically.',
        inputSchema: z.object({
          path: z.string().describe('Absolute path of the file to write.'),
          content: z.string().describe('Full content of the file.'),
        }),
        execute: async ({ path: filePath, content }) => {
          const safe = await this.resolveSafe(filePath, true);
          const existed = !!(await fs.stat(safe).catch(() => null));
          await fs.mkdir(path.dirname(safe), { recursive: true });
          await fs.writeFile(safe, content, 'utf-8');
          return { path: safe, action: existed ? 'overwritten' : 'created', bytes: Buffer.byteLength(content) };
        },
      }),

      editFile: tool({
        description: 'Edit a file by exact string replacement. oldString must appear exactly once in the file. Prefer this over writeFile for small changes to existing files.',
        inputSchema: z.object({
          path: z.string().describe('Absolute path of the file to edit.'),
          oldString: z.string().describe('Exact text to replace (must be unique in the file).'),
          newString: z.string().describe('Replacement text.'),
        }),
        execute: async ({ path: filePath, oldString, newString }) => {
          const safe = await this.resolveSafe(filePath, true);
          const raw = await fs.readFile(safe, 'utf-8');
          const occurrences = raw.split(oldString).length - 1;
          if (occurrences === 0) throw new Error('oldString not found in file.');
          if (occurrences > 1) throw new Error(`oldString appears ${occurrences} times; provide a more specific string.`);
          await fs.writeFile(safe, raw.replace(oldString, newString), 'utf-8');
          return { path: safe, action: 'edited', replaced: oldString.slice(0, 120) };
        },
      }),

      listDir: tool({
        description: 'List the entries of a directory in the local workspace.',
        inputSchema: z.object({ path: z.string().describe('Absolute path of the directory.') }),
        execute: async ({ path: dirPath }) => {
          const safe = await this.resolveSafe(dirPath);
          const entries = await fs.readdir(safe, { withFileTypes: true });
          return entries
            .filter(e => !DENY_PATTERNS.some(p => p.test(path.join(safe, e.name))))
            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
        },
      }),

      glob: tool({
        description: 'Find files matching a glob pattern (e.g. "**/*.md") inside a workspace root.',
        inputSchema: z.object({
          pattern: z.string().describe('Glob pattern relative to root.'),
          root: z.string().optional().describe('Absolute directory to search in (defaults to first workspace root).'),
        }),
        execute: async ({ pattern, root }) => {
          const safe = await this.resolveSafe(root ?? this.workspaceRoots[0]);
          const files = await fg(pattern, { cwd: safe, absolute: true, ignore: ['**/node_modules/**', '**/.git/**'], dot: false });
          return { count: files.length, files: files.slice(0, 200) };
        },
      }),

      grep: tool({
        description: 'Search file contents with a regex inside the workspace. Returns matching path:line pairs.',
        inputSchema: z.object({
          pattern: z.string().describe('Regular expression to search for.'),
          root: z.string().optional().describe('Absolute directory to search in (defaults to first workspace root).'),
          glob: z.string().optional().describe('Limit search to files matching this glob (default "**/*.md").'),
        }),
        execute: async ({ pattern, root, glob: fileGlob }) => {
          const safe = await this.resolveSafe(root ?? this.workspaceRoots[0]);
          const regex = new RegExp(pattern);
          const files = await fg(fileGlob ?? '**/*.md', { cwd: safe, absolute: true, ignore: ['**/node_modules/**', '**/.git/**'] });
          const matches: { file: string; line: number; text: string }[] = [];
          for (const file of files.slice(0, 500)) {
            const raw = await fs.readFile(file, 'utf-8').catch(() => '');
            raw.split('\n').forEach((line, i) => {
              if (matches.length < 100 && regex.test(line)) matches.push({ file, line: i + 1, text: line.trim().slice(0, 200) });
            });
            if (matches.length >= 100) break;
          }
          return { count: matches.length, matches };
        },
      }),
    };
  }
}
