import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import mongoose, { Model } from 'mongoose';
import { Subject, filter } from 'rxjs';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { IAgenticHeartbeat, IAgenticProfile } from '../agentic-profile/models/agentic-profile.models';
import { AcpBridgeService, AcpEngine } from '../local-agent/acp-bridge.service';
import { LocalAgentChatService } from '../local-agent/local-agent-chat.service';
import { WorkspaceService } from '../workspaces/services/workspace.service';
import { AgenticHeartbeatRunDocument, AgenticHeartbeatRunEntity, HeartbeatRunTrigger, IHeartbeatToolCall } from './schemas/agentic-heartbeat-run.schema';

const CRON_PREFIX = 'agentic-heartbeat:';
const RUN_HARD_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_CHARS = 200_000;
const LIVE_BUFFER_TTL_MS = 5 * 60 * 1000; // keep the live event buffer a while after the run ends (late subscribers)
const DEFAULT_HEARTBEAT_TIMEZONE = 'America/Mexico_City';

/** Event pushed to live subscribers (SSE) while a heartbeat run is executing. */
export interface IHeartbeatLiveEvent {
  type: 'status' | 'text-delta' | 'thought-delta' | 'tool-call' | 'tool-result' | 'permission' | 'error' | 'finish';
  at: string; // ISO timestamp
  message?: string; // status / permission / error human-readable text
  text?: string; // text-delta chunk
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status?: 'completed' | 'failed'; // on finish
  usage?: unknown;
}

interface LiveRunChannel {
  orgId?: string;
  profileId: string;
  profileName?: string;
  events: IHeartbeatLiveEvent[];
  listeners: Set<(event: IHeartbeatLiveEvent) => void>;
  done: boolean;
}

export interface IGlobalHeartbeatEvent {
  orgId?: string;
  profileId: string;
  profileName?: string;
  runId: string;
  event: IHeartbeatLiveEvent;
}

/**
 * Default wake-up used to test the autonomy loop end to end: the agent explores the web
 * and records what it found. Replaced by heartbeat.wakePrompt when the profile defines one.
 */
const DEFAULT_WAKE_PROMPT = `Es hora de tu revisión periódica (heartbeat). Acabas de despertar de forma autónoma, sin intervención humana.

Tu contexto de perfil agéntico (identidad, conocimiento, skills, tareas, memorias y briefing) viene adjunto como recurso. Tienes acceso al sistema de archivos del workspace y a internet a través de tus herramientas.

En esta sesión de prueba tu misión es EXPLORAR:
1. Elige un tema relevante a tu dominio y a las prioridades de tu Live Briefing.
2. Busca en internet información reciente sobre ese tema.
3. Escribe un reporte breve en markdown con lo que encontraste: qué buscaste, hallazgos clave, fuentes y qué recomiendas hacer al respecto.
4. Si tienes acceso de escritura a tu carpeta de exploraciones (explorations/), guarda ahí el reporte como un nuevo archivo con fecha en el nombre; si no, simplemente devuélvelo completo en tu respuesta.

Al final responde SIEMPRE con el reporte completo en markdown. Sé concreto y cita tus fuentes.`;

@Injectable()
export class AgenticHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private logger = new Logger(AgenticHeartbeatService.name);
  private runningProfiles = new Set<string>();
  private liveRuns = new Map<string, LiveRunChannel>();
  readonly globalEvents$ = new Subject<IGlobalHeartbeatEvent>();

  constructor(
    @InjectModel(AgenticHeartbeatRunEntity.name)
    private readonly runModel: Model<AgenticHeartbeatRunDocument>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly agenticProfileService: AgenticProfileService,
    private readonly acpBridge: AcpBridgeService,
    private readonly localAgentChatService: LocalAgentChatService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  async onApplicationBootstrap() {
    await this.syncAllSchedules().catch(err => this.logger.error(`Failed to sync heartbeat schedules: ${err.message}`));
  }

  onModuleDestroy() {
    for (const name of this.schedulerRegistry.getCronJobs().keys()) {
      if (name.startsWith(CRON_PREFIX)) this.schedulerRegistry.deleteCronJob(name);
    }
    this.globalEvents$.complete();
  }

  getNextRunDate(profileId: string): Date | null {
    const jobName = `${CRON_PREFIX}${profileId}`;
    try {
      if (!this.schedulerRegistry.doesExist('cron', jobName)) return null;
      const nextDate = this.schedulerRegistry.getCronJob(jobName).nextDate();
      return nextDate?.toJSDate() ?? null;
    } catch (err) {
      this.logger.warn(`Could not get next heartbeat date for ${profileId}: ${err?.message ?? err}`);
      return null;
    }
  }

  /** Registers a cron job for every profile with heartbeat.enabled (called on boot). */
  async syncAllSchedules(): Promise<void> {
    const profiles: IAgenticProfile[] = await this.agenticProfileService.executeOperation({
      action: 'find',
      query: { 'heartbeat.enabled': true },
    });
    for (const profile of profiles) {
      this.scheduleProfile(profile);
    }
    this.logger.log(`Agentic heartbeat scheduler ready — ${profiles.length} profile(s) with heartbeat enabled.`);
  }

  /** Creates/replaces the cron job for one profile. Removes it when heartbeat is disabled or invalid. */
  scheduleProfile(profile: IAgenticProfile): void {
    const profileId = profile.id || profile._id?.toString();
    if (!profileId) return;
    const jobName = `${CRON_PREFIX}${profileId}`;

    if (this.schedulerRegistry.doesExist('cron', jobName)) {
      this.schedulerRegistry.deleteCronJob(jobName);
    }

    const heartbeat = profile.heartbeat;
    if (!heartbeat?.enabled || !heartbeat.cronExpression) return;

    try {
      const timezone = heartbeat.timezone || DEFAULT_HEARTBEAT_TIMEZONE;
      const job = new CronJob(
        heartbeat.cronExpression,
        () => {
          this.runHeartbeat(profileId, 'cron', profile.orgId).catch(err =>
            this.logger.error(`Heartbeat run failed for profile ${profileId}: ${err.message}`),
          );
        },
        null,
        false,
        timezone,
      );
      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
      this.logger.log(`Heartbeat scheduled for profile ${profileId} (${profile.name ?? ''}) → "${heartbeat.cronExpression}" (${timezone})`);
    } catch (err) {
      this.logger.error(`Invalid cron expression "${heartbeat.cronExpression}" for profile ${profileId}: ${err.message}`);
    }
  }

  /** Persists the heartbeat config on the profile and reschedules its cron job. */
  async updateHeartbeatConfig(profileId: string, orgId: string | undefined, config: IAgenticHeartbeat): Promise<IAgenticHeartbeat> {
    const heartbeat: IAgenticHeartbeat = {
      enabled: !!config.enabled,
      cronExpression: config.cronExpression?.trim() || undefined,
      timezone: config.timezone?.trim() || DEFAULT_HEARTBEAT_TIMEZONE,
      engine: config.engine || 'agy',
      wakePrompt: config.wakePrompt?.trim() || undefined,
    };

    if (heartbeat.enabled && heartbeat.cronExpression) {
      // Validate before persisting so the UI gets an immediate error on a bad expression.
      new CronJob(heartbeat.cronExpression, () => undefined, null, false, heartbeat.timezone);
    }

    const query: any = this.buildIdQuery(profileId, orgId);
    await this.agenticProfileService.executeOperation({
      action: 'updateOne',
      query,
      payload: { $set: { heartbeat } },
    });

    const profile = await this.findProfile(profileId, orgId);
    if (profile) this.scheduleProfile(profile);
    return heartbeat;
  }

  /** Fire-and-forget heartbeat execution. Returns the run id immediately. */
  async triggerNow(profileId: string, orgId?: string): Promise<{ runId: string }> {
    const runId = await this.runHeartbeat(profileId, 'manual', orgId, { detach: true });
    return { runId };
  }

  async listRuns(profileId: string, orgId?: string, limit = 20): Promise<AgenticHeartbeatRunEntity[]> {
    const query: any = { profileId };
    if (orgId) query.orgId = orgId;
    return this.runModel.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  async getRun(runId: string, orgId?: string): Promise<AgenticHeartbeatRunEntity | null> {
    const query: any = { id: runId };
    if (orgId) query.orgId = orgId;
    return this.runModel.findOne(query).lean().exec();
  }

  /**
   * Live SSE stream of a run: replays every event emitted so far and then follows the run
   * in real time until it finishes. If the run already ended it just replays the buffer.
   */
  async *streamRunLive(runId: string): AsyncGenerator<IHeartbeatLiveEvent> {
    const channel = this.liveRuns.get(runId);
    if (!channel) {
      // Run unknown or buffer expired: report its final state from the DB so the UI can settle.
      const run = await this.getRun(runId);
      const status = run?.status === 'failed' ? 'failed' : 'completed';
      yield { type: 'finish', at: new Date().toISOString(), status, message: run ? `Corrida ${run.status}.` : 'Corrida no encontrada.' };
      return;
    }

    let cursor = 0;
    let notify: (() => void) | null = null;
    const listener = () => {
      notify?.();
      notify = null;
    };
    channel.listeners.add(listener);
    try {
      while (true) {
        while (cursor < channel.events.length) yield channel.events[cursor++];
        if (channel.done) return;
        await new Promise<void>(resolve => (notify = resolve));
      }
    } finally {
      channel.listeners.delete(listener);
    }
  }

  async *streamGlobalLive(orgId: string, signal?: AbortSignal): AsyncGenerator<IGlobalHeartbeatEvent> {
    const queue: IGlobalHeartbeatEvent[] = [];
    let notify: (() => void) | undefined;
    const subscription = this.globalEvents$.pipe(filter(item => item.orgId === orgId)).subscribe(item => {
      queue.push(item);
      notify?.();
      notify = undefined;
    });
    try {
      while (!signal?.aborted) {
        while (queue.length) yield queue.shift()!;
        await new Promise<void>(resolve => {
          notify = resolve;
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    } finally {
      subscription.unsubscribe();
    }
  }

  private publishLive(runId: string, event: Omit<IHeartbeatLiveEvent, 'at'>): void {
    const channel = this.liveRuns.get(runId);
    if (!channel) return;
    const liveEvent = { ...event, at: new Date().toISOString() } as IHeartbeatLiveEvent;
    channel.events.push(liveEvent);
    this.globalEvents$.next({
      orgId: channel.orgId,
      profileId: channel.profileId,
      profileName: channel.profileName,
      runId,
      event: liveEvent,
    });
    if (event.type === 'finish') channel.done = true;
    for (const listener of channel.listeners) listener(channel.events[channel.events.length - 1]);
    if (channel.done) setTimeout(() => this.liveRuns.delete(runId), LIVE_BUFFER_TTL_MS).unref?.();
  }

  /**
   * Wakes the agent: composes the profile full-context, opens an ACP session (agy by default),
   * auto-approves tool permissions, and persists the whole run in agentic_heartbeat_runs.
   */
  private async runHeartbeat(
    profileId: string,
    trigger: HeartbeatRunTrigger,
    orgId?: string,
    options?: { detach?: boolean },
  ): Promise<string> {
    if (this.runningProfiles.has(profileId)) {
      throw new Error(`El perfil ${profileId} ya tiene un heartbeat en ejecución.`);
    }

    const profile = await this.findProfile(profileId, orgId);
    if (!profile) throw new Error(`AgenticProfile ${profileId} no encontrado.`);

    const engine = (profile.heartbeat?.engine || 'agy') as AcpEngine;
    const prompt = profile.heartbeat?.wakePrompt || DEFAULT_WAKE_PROMPT;

    const run = await this.runModel.create({
      orgId: profile.orgId,
      profileId,
      profileName: profile.name,
      trigger,
      engine,
      prompt,
      status: 'running',
      startedAt: new Date(),
      toolCalls: [],
    });
    const runId = run.id || run._id.toString();
    this.liveRuns.set(runId, {
      orgId: profile.orgId,
      profileId,
      profileName: profile.name,
      events: [],
      listeners: new Set(),
      done: false,
    });

    this.runningProfiles.add(profileId);
    const execution = this.executeRun(run, profile, engine, prompt)
      .catch(err => this.finishRun(run, 'failed', undefined, [], String(err?.message ?? err), undefined))
      .finally(() => this.runningProfiles.delete(profileId));

    if (!options?.detach) await execution;
    return runId;
  }

  private async executeRun(run: AgenticHeartbeatRunDocument, profile: IAgenticProfile, engine: AcpEngine, prompt: string): Promise<void> {
    const profileId = run.profileId;
    const runId = run.id || run._id.toString();
    const tag = `💓 [${profile.name ?? profileId}]`;
    this.logger.log(`${tag} Wake-up via ${engine} [${run.trigger}] — run ${runId}`);
    this.publishLive(runId, { type: 'status', message: `Despertando via ${engine} (${run.trigger})...` });

    // Heartbeats need operational state. Keep an explicit FULL profile; otherwise
    // promote chat-oriented BASIC profiles to MEDIUM for autonomous execution.
    const heartbeatContextLevel = profile.contextLevel === 'full' ? 'full' : 'medium';
    const context = await this.localAgentChatService.getProfileContext(profileId, profile.orgId, heartbeatContextLevel).catch(err => {
      this.logger.warn(`Could not compose full-context for ${profileId}: ${err.message}`);
      return undefined;
    });
    this.publishLive(runId, {
      type: 'status',
      message: context ? `Contexto del perfil compilado (${context.length} chars). Abriendo sesión ACP...` : 'No se pudo compilar el contexto; despertando sin él...',
    });

    let output = '';
    let error: string | undefined;
    const toolCalls: IHeartbeatToolCall[] = [];
    let sessionId: string | undefined;
    let runUsage: any = undefined;
    const deadline = Date.now() + RUN_HARD_TIMEOUT_MS;

    // A profile bound to a workspace wakes up in that workspace's root on this host
    const workspaceCwd = this.workspaceService.resolveRootForHost((profile as any).workspaceId) ?? undefined;
    if (workspaceCwd) {
      this.publishLive(runId, { type: 'status', message: `Workspace: ${(profile as any).workspaceId} (${workspaceCwd})` });
    }

    for await (const event of this.acpBridge.stream(prompt, undefined, context, engine, { cwd: workspaceCwd })) {
      if (Date.now() > deadline) {
        error = `Heartbeat abortado: superó el límite de ${RUN_HARD_TIMEOUT_MS / 60000} minutos.`;
        if (sessionId) await this.acpBridge.cancel(sessionId).catch(() => undefined);
        break;
      }
      switch (event.type) {
        case 'session':
          sessionId = event.sessionId;
          this.publishLive(runId, { type: 'status', message: 'Sesión ACP abierta. El agente está pensando...' });
          break;
        case 'text-delta':
          if (output.length < MAX_OUTPUT_CHARS) output += event.text;
          this.publishLive(runId, { type: 'text-delta', text: event.text });
          break;
        case 'reasoning-delta':
          this.publishLive(runId, { type: 'thought-delta', text: event.text });
          break;
        case 'tool-call':
          toolCalls.push({ toolName: event.toolName, input: this.truncate(event.input) });
          this.logger.log(`${tag} 🔧 tool-call #${toolCalls.length}: ${event.toolName} ${this.toLogPreview(event.input)}`);
          this.publishLive(runId, { type: 'tool-call', toolName: event.toolName, input: this.truncate(event.input, 600) });
          break;
        case 'tool-result': {
          const last = [...toolCalls].reverse().find(t => t.toolName === event.toolName && t.output === undefined);
          if (last) last.output = this.truncate(event.output);
          this.logger.log(`${tag} ✅ tool-result: ${event.toolName} ${this.toLogPreview(event.output)}`);
          this.publishLive(runId, { type: 'tool-result', toolName: event.toolName, output: this.truncate(event.output, 600) });
          break;
        }
        case 'permission-request': {
          // Headless run: nobody is watching the UI, so approve automatically (prefer the broadest allow).
          const preferred =
            event.options.find(o => o.kind === 'allow_always') ??
            event.options.find(o => o.kind === 'allow_once') ??
            event.options[0];
          if (sessionId && preferred) {
            this.logger.log(`${tag} 🔓 Auto-approving tool "${event.toolName}" (${preferred.kind})`);
            this.publishLive(runId, { type: 'permission', toolName: event.toolName, message: `Permiso auto-aprobado (${preferred.kind})` });
            this.acpBridge.respondPermission(sessionId, event.requestId, preferred.optionId);
          }
          break;
        }
        case 'error':
          error = event.error;
          this.logger.error(`${tag} ❌ engine error: ${event.error}`);
          this.publishLive(runId, { type: 'error', message: event.error });
          break;
        case 'finish':
          runUsage = event.usage;
          break;
        default:
          break;
      }
    }

    await this.finishRun(run, error ? 'failed' : 'completed', output, toolCalls, error, runUsage);
    this.logger.log(`💓 Heartbeat finished for ${profileId}: ${error ? `FAILED (${error})` : `${output.length} chars, ${toolCalls.length} tool call(s)`}`);
  }

  private async finishRun(
    run: AgenticHeartbeatRunDocument,
    status: 'completed' | 'failed',
    output?: string,
    toolCalls?: IHeartbeatToolCall[],
    error?: string,
    usage?: any,
  ): Promise<void> {
    const finishedAt = new Date();
    run.status = status;
    if (output !== undefined) run.output = output;
    if (toolCalls?.length) run.toolCalls = toolCalls;
    if (error) run.error = error;
    if (usage !== undefined) run.usage = usage;
    run.finishedAt = finishedAt;
    run.durationMs = run.startedAt ? finishedAt.getTime() - run.startedAt.getTime() : undefined;
    await run.save().catch(err => this.logger.error(`Could not persist heartbeat run ${run.id}: ${err.message}`));
    this.publishLive(run.id || run._id.toString(), {
      type: 'finish',
      status,
      usage,
      message: status === 'failed' ? (error ?? 'La corrida falló.') : `Corrida completada — ${toolCalls?.length ?? 0} tool call(s), ${output?.length ?? 0} chars.`,
    });
  }

  /** Compact single-line preview of a tool payload for backend logs. */
  private toLogPreview(value: unknown, max = 300): string {
    if (value === undefined || value === null) return '';
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const flat = raw.replace(/\s+/g, ' ');
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
  }

  private async findProfile(profileId: string, orgId?: string): Promise<IAgenticProfile | null> {
    return this.agenticProfileService.executeOperation({
      action: 'findOne',
      query: this.buildIdQuery(profileId, orgId),
    });
  }

  private buildIdQuery(profileId: string, orgId?: string): any {
    const or: any[] = [{ id: profileId }];
    if (mongoose.Types.ObjectId.isValid(profileId)) {
      or.push({ _id: new mongoose.Types.ObjectId(profileId) });
    }
    const query: any = { $or: or };
    if (orgId) query.orgId = orgId;
    return query;
  }

  private truncate(value: unknown, max = 4000): unknown {
    if (typeof value === 'string' && value.length > max) return `${value.slice(0, max)}… [truncated]`;
    if (value && typeof value === 'object') {
      const json = JSON.stringify(value);
      if (json.length > max) return `${json.slice(0, max)}… [truncated]`;
    }
    return value;
  }
}
