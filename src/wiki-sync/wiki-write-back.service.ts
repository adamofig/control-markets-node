import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { WorkspaceService } from '../workspaces/services/workspace.service';
import { AgentTasksService } from '../agent-tasks/services/agent-tasks.service';
import { SourcesService } from '../agent-tasks/services/sources.service';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { buildFingerprint, hashContent } from '../agentic-profile/services/sync-hash.util';
import { WIKI_PROFILE_CHANGED, WIKI_SOURCE_CHANGED, WIKI_TASK_CHANGED, WikiEntityChangedEvent } from './wiki-sync.events';
import { DEFAULT_TASK_PRIORITY, TASK_STATUS_MARKS } from '../agent-tasks/models/classes';

/**
 * Matches the leading `- [x] #07 P4 ` part of a Section 6 task line, so mark, number badge and
 * priority badge are rewritten together without touching the link or the description.
 *
 * The number is a badge *outside* the link and never part of the label: the sync stores `link.label`
 * as the task's `name`, so folding "07." into it would push the number into the DB name and it would
 * be re-prefixed on every round trip.
 */
const PROFILE_TASK_LINE_PREFIX = /^(\s*-\s*)\[\s*[xX/rR-]?\s*\]\s*(?:#\d+\s+)?(?:P[1-5]\s+)?/;

/**
 * Phase 2 of the sync contract: local write-back (DB → wiki `.md` files).
 *
 * Only active when the backend runs on a developer machine:
 *   WIKI_LOCAL_WRITE === 'true'  AND  NODE_ENV !== 'production'
 * and every resolved path must stay inside the workspace root (anti-escape).
 *
 * 3-way rule (see 01-sync-md-files.md): the sync owns the auto frontmatter keys
 * (status/priority/taskId/sourceId/orgId) — those are excluded from the content hash and can
 * always be written. The BODY is only overwritten when the local file is unchanged
 * since the last sync (sha256(local) === entity.contentHash); otherwise the DB
 * version is left next to the file as `<name>.md.db-version` and a conflict is logged.
 */
@Injectable()
export class WikiWriteBackService {
  private readonly logger = new Logger(WikiWriteBackService.name);

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly agentTasksService: AgentTasksService,
    private readonly sourcesService: SourcesService,
    private readonly agenticProfileService: AgenticProfileService,
  ) {}

  private get enabled(): boolean {
    return process.env.WIKI_LOCAL_WRITE === 'true' && process.env.NODE_ENV !== 'production';
  }

  // ------------------------------------------------------------------ events

  @OnEvent(WIKI_TASK_CHANGED, { async: true })
  async onTaskChanged(event: WikiEntityChangedEvent): Promise<void> {
    if (!this.enabled || !event?.id) return;
    try {
      const task: any = await this.agentTasksService.findOne(event.id);
      if (!task) return;
      if (task.relPath && task.workspaceId) {
        await this.writeBackExistingTask(task);
      } else {
        await this.materializeNewTaskFile(task);
      }
    } catch (err) {
      this.logger.warn(`Task write-back failed for ${event.id}: ${err.message}`);
    }
  }

  @OnEvent(WIKI_SOURCE_CHANGED, { async: true })
  async onSourceChanged(event: WikiEntityChangedEvent): Promise<void> {
    if (!this.enabled || !event?.id) return;
    try {
      const source: any = await this.sourcesService.findOne(event.id);
      if (!source?.relPath || !source?.workspaceId) return; // sources are never materialized, only mirrored
      await this.writeBackSource(source);
    } catch (err) {
      this.logger.warn(`Source write-back failed for ${event.id}: ${err.message}`);
    }
  }

  @OnEvent(WIKI_PROFILE_CHANGED, { async: true })
  async onProfileChanged(event: WikiEntityChangedEvent): Promise<void> {
    if (!this.enabled || !event?.id) return;
    try {
      const profile: any = await this.agenticProfileService.findOne(event.id);
      if (!profile?.relPath || !profile?.workspaceId) {
        this.logger.warn(`Profile ${event.id} has no relPath/workspaceId — run the CLI sync once to register it. Skipping live-briefing write-back.`);
        return;
      }
      await this.writeBackLiveBriefing(profile);
    } catch (err) {
      this.logger.warn(`Profile write-back failed for ${event.id}: ${err.message}`);
    }
  }

  // ---------------------------------------------------------- task write-back

  /** Mirrors DB status (frontmatter + profile checkbox) and, when safe, DB content into the task file. */
  private async writeBackExistingTask(task: any): Promise<void> {
    const located = this.locate(task.workspaceId, task.relPath);
    if (!located) return;
    const { abs, root } = located;
    if (!fs.existsSync(abs)) {
      this.logger.warn(`Task file missing locally, skipping write-back: ${task.relPath}`);
      return;
    }

    const local = fs.readFileSync(abs, 'utf-8');
    const localHash = hashContent(local);
    const autoKeys = { status: task.status, priority: task.priority, taskNumber: task.taskNumber, taskId: this.idOf(task), orgId: task.orgId };
    const localBodyUnchanged = !task.contentHash || localHash === task.contentHash;
    const dbBodyHash = task.content ? hashContent(task.content) : null;

    let target: string;
    if (localBodyUnchanged && task.content && dbBodyHash !== localHash) {
      // Local file is clean and the DB body moved on (UI edit) → adopt the DB version.
      target = this.setFrontmatterKeys(task.content, autoKeys);
    } else {
      // Only the sync-owned frontmatter keys are written; the local body always wins.
      target = this.setFrontmatterKeys(local, autoKeys);
      if (!localBodyUnchanged && dbBodyHash && dbBodyHash !== localHash && dbBodyHash !== task.contentHash) {
        // Both sides edited the body → leave the DB version aside, never overwrite.
        fs.writeFileSync(`${abs}.db-version`, this.setFrontmatterKeys(task.content, autoKeys), 'utf-8');
        this.logger.warn(`CONFLICT: local and DB both changed ${task.relPath} — wrote ${path.basename(abs)}.db-version`);
      }
    }

    if (target !== local) {
      fs.writeFileSync(abs, target, 'utf-8');
      this.logger.log(`Wrote back task file: ${task.relPath} (status=${task.status})`);
    }
    // Advance the sync baseline ONLY when the local file was clean — after a conflict the
    // old baseline must survive, otherwise the next event would mistake the local edits
    // for "already synced" and overwrite them with the DB body.
    if (localBodyUnchanged) {
      const newHash = hashContent(target);
      if (newHash !== task.contentHash) {
        await this.agentTasksService.updateSyncContract(this.idOf(task), { contentHash: newHash });
      }
    }

    await this.updateProfileTaskCheckbox(task, root);
  }

  /** A task created outside the wiki (UI/heartbeat): create its `.md` in the agent's tasks/ folder
   * and register it in Section 6 of the profile, so the next CLI sync converges to 0 changed. */
  private async materializeNewTaskFile(task: any): Promise<void> {
    if (task.sourceUrl || task.relPath) return; // already file-backed
    const taskId = this.idOf(task);
    const profile = await this.findProfileForTask(task);
    if (!profile) return;
    if (!profile.workspaceId || !profile.relPath) {
      this.logger.warn(`Profile ${profile.id} has no workspaceId/relPath — run the CLI sync once to register it. Skipping file creation for task "${task.name}".`);
      return;
    }
    const located = this.locate(profile.workspaceId, profile.relPath);
    if (!located || !fs.existsSync(located.abs)) return;
    const { abs: profileAbs, root } = located;

    const profileDir = path.dirname(profileAbs);
    const tasksDir = path.join(profileDir, 'tasks');
    if (!tasksDir.startsWith(path.resolve(root) + path.sep)) return; // anti-escape
    fs.mkdirSync(tasksDir, { recursive: true });

    // The file prefix follows the assignee's sequence, so `tasks/07-*.md` and `taskNumber: 7` agree
    // and the CLI can keep inferring one from the other.
    const fileName = this.nextTaskFileName(tasksDir, task.name || 'tarea', task.taskNumber);
    const taskAbs = path.join(tasksDir, fileName);
    const sourceUrl = `tasks/${fileName}`;

    // File body: frontmatter owned by the sync + a markdown skeleton mirroring existing task files
    let body = `# Tarea: ${task.name || 'Sin título'}\n\n`;
    body += `- **Agente Asignado**: [${profile.agentCard?.name || 'Agente'}](../${path.basename(profileAbs)})\n\n`;
    if (task.description) body += `## 🎯 Objetivo\n\n${task.description}\n`;
    if (task.content) body += `\n${task.content}\n`;
    const content = this.setFrontmatterKeys(body, {
      status: task.status || 'pending',
      priority: task.priority ?? DEFAULT_TASK_PRIORITY,
      taskNumber: task.taskNumber,
      orgId: task.orgId,
      taskId,
    });

    fs.writeFileSync(taskAbs, content, 'utf-8');
    this.logger.log(`Created local task file: ${sourceUrl} for profile ${profile.name}`);

    const relPath = path.relative(path.resolve(root), taskAbs).split(path.sep).join('/');
    await this.agentTasksService.updateSyncContract(taskId, {
      sourceUrl,
      relPath,
      workspaceId: profile.workspaceId,
      fingerprint: buildFingerprint(profile.workspaceId, relPath),
      contentHash: hashContent(content),
    });

    // Register the task in Section 6 of the profile file + in the profile.tasks refs
    this.insertProfileTaskLine(profileAbs, task, sourceUrl);
    await this.ensureProfileTaskRef(profile, task);
  }

  // -------------------------------------------------------- source write-back

  private async writeBackSource(source: any): Promise<void> {
    const located = this.locate(source.workspaceId, source.relPath);
    if (!located) return;
    const { abs } = located;
    if (!fs.existsSync(abs) || !source.content) return;

    const local = fs.readFileSync(abs, 'utf-8');
    const localHash = hashContent(local);
    const dbHash = hashContent(source.content);
    if (dbHash === localHash) return; // nothing new

    if (source.contentHash && localHash !== source.contentHash) {
      // Local has unsynced edits → never overwrite
      fs.writeFileSync(`${abs}.db-version`, source.content, 'utf-8');
      this.logger.warn(`CONFLICT: local and DB both changed ${source.relPath} — wrote ${path.basename(abs)}.db-version`);
      return;
    }
    fs.writeFileSync(abs, source.content, 'utf-8');
    this.logger.log(`Wrote back source file: ${source.relPath}`);
    await this.sourcesService.updateSyncContract(this.idOf(source), { contentHash: dbHash });
  }

  // ------------------------------------------------------------ profile edits

  /**
   * Mirrors the DB live briefing into Section 8 of the profile `.md`. Surgical: only the body
   * under the `## 8` heading is rewritten, every other section stays byte-identical (so no task/
   * source hash is affected). The `## 8` heading line itself (its title) is preserved.
   */
  private async writeBackLiveBriefing(profile: any): Promise<void> {
    const located = this.locate(profile.workspaceId, profile.relPath);
    if (!located || !fs.existsSync(located.abs)) {
      this.logger.warn(`Profile file missing locally, skipping live-briefing write-back: ${profile.relPath}`);
      return;
    }
    const content = fs.readFileSync(located.abs, 'utf-8').replace(/\r\n/g, '\n');
    const briefing = (profile.liveBriefing ?? '').trim();
    const updated = this.replaceSection8(content, briefing);
    if (updated === null) {
      this.logger.warn(`Profile file has no "## 8." section — live briefing not written for ${profile.name}`);
      return;
    }
    if (updated === content) return; // already in sync, nothing to write
    fs.writeFileSync(located.abs, updated, 'utf-8');
    this.logger.log(`Updated Section 8 live briefing for profile "${profile.name}"`);
  }

  /**
   * Returns `content` with the body under the `## 8` heading replaced by `briefing`.
   * Returns null if there's no Section 8 heading. Parser-compatible: the stored value is the
   * trimmed text between the `## 8` header and the next `## N` header (or EOF), so we round-trip it.
   */
  private replaceSection8(content: string, briefing: string): string | null {
    const lines = content.split('\n');
    const start = lines.findIndex(l => /^##\s+8\.?(\s|$)/.test(l));
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+\d/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const trailingNextSection = end < lines.length; // there's another section after 8
    const rebuilt = [
      ...lines.slice(0, start), // frontmatter + sections 1-7, untouched
      lines[start], // the "## 8. ..." heading, preserved verbatim
      '',
      ...(briefing ? [briefing] : []),
      '',
      ...(trailingNextSection ? lines.slice(end) : []),
    ];
    let result = rebuilt.join('\n');
    if (!trailingNextSection && !result.endsWith('\n')) result += '\n';
    return result;
  }

  /** Rewrites the `- [ ]/[/]/[r]/[x]/[-]` mark and the `P<n>` badge of the task's line in Section 6. */
  private async updateProfileTaskCheckbox(task: any, root: string): Promise<void> {
    const profile = await this.findProfileForTask(task);
    if (!profile?.relPath || !profile?.workspaceId) return;
    const located = this.locate(profile.workspaceId, profile.relPath);
    if (!located || !fs.existsSync(located.abs)) return;

    const content = fs.readFileSync(located.abs, 'utf-8');
    const mark = this.statusToMark(task.status);
    const badge = `${this.numberBadge(task.taskNumber)}${this.priorityBadge(task.priority)}`;
    const lines = content.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      if (task.sourceUrl && lines[i].includes(`](${task.sourceUrl})`)) {
        const updated = lines[i].replace(PROFILE_TASK_LINE_PREFIX, `$1[${mark}] ${badge}`);
        if (updated !== lines[i]) {
          lines[i] = updated;
          changed = true;
        }
      }
    }
    if (changed) {
      fs.writeFileSync(located.abs, lines.join('\n'), 'utf-8');
      this.logger.log(`Updated Section 6 line for "${task.name}" → [${mark}] ${badge}`.trim());
    }
  }

  /**
   * Section 6 badge for the priority. Only non-default priorities are rendered, so a profile with
   * 20 ordinary tasks stays readable; the authoritative value always lives in the task frontmatter.
   */
  private priorityBadge(priority?: number): string {
    return priority && priority !== DEFAULT_TASK_PRIORITY ? `P${priority} ` : '';
  }

  /**
   * Section 6 badge for the correlative number: `#07`. Always rendered when the task has one —
   * unlike the priority badge, there is no "default" number to hide, and the whole point of the
   * field is that a human can read it off the list and say "ejecuta la tarea 7".
   */
  private numberBadge(taskNumber?: number): string {
    return taskNumber ? `#${String(taskNumber).padStart(2, '0')} ` : '';
  }

  /** Appends the new task's checkbox line at the end of the Section 6 list of the profile file. */
  private insertProfileTaskLine(profileAbs: string, task: any, sourceUrl: string): void {
    const content = fs.readFileSync(profileAbs, 'utf-8');
    if (content.includes(`](${sourceUrl})`)) return;
    const lines = content.split('\n');
    const start = lines.findIndex(l => /^##\s+6\.?\s/.test(l));
    if (start === -1) {
      this.logger.warn(`Profile file has no "## 6." section — task line not inserted for "${task.name}"`);
      return;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+\d/.test(lines[i])) {
        end = i;
        break;
      }
    }
    let insertAfter = -1;
    for (let i = start + 1; i < end; i++) {
      if (/^\s*-\s*\[/.test(lines[i])) insertAfter = i;
    }
    const mark = this.statusToMark(task.status);
    const desc = task.description ? ` — ${task.description}` : '';
    const line = `- [${mark}] ${this.numberBadge(task.taskNumber)}${this.priorityBadge(task.priority)}**[${task.name}](${sourceUrl})**${desc}`;
    lines.splice(insertAfter !== -1 ? insertAfter + 1 : start + 1, 0, line);
    fs.writeFileSync(profileAbs, lines.join('\n'), 'utf-8');
    this.logger.log(`Inserted Section 6 line for new task "${task.name}"`);
  }

  /** Makes sure profile.tasks contains a ref for the task (UI flows may create the task detached). */
  private async ensureProfileTaskRef(profile: any, task: any): Promise<void> {
    const taskId = this.idOf(task);
    const refs = profile.tasks || [];
    if (refs.some((t: any) => t.id === taskId)) return;
    await this.agenticProfileService.executeOperation({
      action: 'updateOne',
      query: { id: profile.id || profile._id?.toString() },
      payload: {
        $push: {
          tasks: {
            id: taskId,
            name: task.name,
            status: task.status || 'pending',
            priority: task.priority ?? DEFAULT_TASK_PRIORITY,
            taskNumber: task.taskNumber,
            updatedAt: task.updatedAt,
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------- utilities

  private async findProfileForTask(task: any): Promise<any> {
    const taskId = this.idOf(task);
    let profile = await this.agenticProfileService.findOneByQuery({ 'tasks.id': taskId, orgId: task.orgId });
    if (!profile) {
      const agentCardId = task.agentCard?.id || (task.assignedType === 'agent' ? task.assignedTo?.id : null);
      if (agentCardId) {
        profile = await this.agenticProfileService.findOneByQuery({ 'agentCard.id': agentCardId, orgId: task.orgId });
      }
    }
    return profile;
  }

  /** Resolves workspaceId + relPath to an absolute path, enforcing the workspace root boundary. */
  private locate(workspaceId: string, relPath: string): { abs: string; root: string } | null {
    const root = this.workspaceService.resolveRootForHost(workspaceId);
    if (!root) return null;
    const abs = path.resolve(root, relPath);
    if (!abs.startsWith(path.resolve(root) + path.sep)) {
      this.logger.warn(`Blocked path escaping workspace root: ${relPath}`);
      return null;
    }
    return { abs, root };
  }

  /**
   * Updates ONLY the given frontmatter keys, leaving every other line byte-identical.
   * The block is parsed with the `yaml` library for correctness, but untouched keys are
   * never re-serialized — reformatting them would silently invalidate content hashes.
   */
  private setFrontmatterKeys(content: string, keys: Record<string, any>): string {
    const text = (content ?? '').replace(/\r\n/g, '\n');
    const entries = Object.entries(keys).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (!entries.length) return text;

    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      const fm = entries.map(([k, v]) => `${k}: ${YAML.stringify(v, { defaultStringType: 'QUOTE_DOUBLE' }).trim()}`).join('\n');
      return `---\n${fm}\n---\n\n${text}`;
    }

    const existing = (YAML.parse(fmMatch[1]) as Record<string, any>) || {};
    let fmLines = fmMatch[1].split('\n');
    for (const [key, value] of entries) {
      if (existing[key] !== undefined && String(existing[key]) === String(value)) continue;
      const rendered = `${key}: ${YAML.stringify(value, { defaultStringType: 'QUOTE_DOUBLE' }).trim()}`;
      const idx = fmLines.findIndex(l => l.slice(0, l.indexOf(':')).trim() === key && l.includes(':'));
      if (idx !== -1) {
        fmLines[idx] = rendered;
      } else {
        fmLines = [...fmLines, rendered];
      }
    }
    const newFm = `---\n${fmLines.join('\n')}\n---`;
    return text.slice(0, fmMatch.index) + newFm + text.slice((fmMatch.index ?? 0) + fmMatch[0].length);
  }

  private statusToMark(status: string): string {
    if (status === 'completed') return TASK_STATUS_MARKS.done; // legacy alias
    return TASK_STATUS_MARKS[status] ?? ' ';
  }

  private nextTaskFileName(tasksDir: string, name: string, taskNumber?: number): string {
    const existing = fs.readdirSync(tasksDir);
    let max = 0;
    for (const f of existing) {
      const m = f.match(/^(\d+)-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    // The DB sequence wins when it exists — the folder max is only the fallback for a profile whose
    // tasks were never numbered (and for the rare file that lives outside any sequence).
    const nn = String(taskNumber || max + 1).padStart(2, '0');
    const slug =
      (name || 'tarea')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'tarea';
    let fileName = `${nn}-${slug}.md`;
    let suffix = 2;
    while (existing.includes(fileName)) {
      fileName = `${nn}-${slug}-${suffix++}.md`;
    }
    return fileName;
  }

  private idOf(entity: any): string {
    return entity.id || entity._id?.toString();
  }
}
