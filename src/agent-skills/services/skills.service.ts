import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { SkillDocument, SkillEntity } from '../schemas/skill.schema';
import * as crypto from 'crypto';
import { IResolvedSkill, ISkill, ISkillBundlePayload, ISkillCatalogCapability, ISkillCatalogEntry, ISkillFile, ISkillSyncResult } from '../models/skill.models';

/** Projection for every listing path — a skill body is a whole `.md`, and no catalog renders it. */
const METADATA_PROJECTION = {
  id: 1,
  orgId: 1,
  kind: 1,
  slug: 1,
  bundleId: 1,
  bundleSlug: 1,
  name: 1,
  description: 1,
  type: 1,
  triggers: 1,
  relPath: 1,
  enabled: 1,
  updatedAt: 1,
};

@Injectable()
export class SkillsService extends EntityCommunicationService<SkillDocument> {
  constructor(
    @InjectModel(SkillEntity.name)
    skillModel: Model<SkillDocument>,
    mongoService: MongoService,
  ) {
    super(skillModel, mongoService);
  }

  /**
   * `aliasIds` is matched alongside `id` so a profile still pointing at a pre-migration source id
   * keeps resolving to the bundle that absorbed it — the migration folds duplicates, it does not
   * strand the references to them.
   */
  async findManyByIds(ids: string[], orgId?: string): Promise<SkillDocument[]> {
    if (!ids?.length) return [];
    return this.genericModel.find({ $or: [{ id: { $in: ids } }, { aliasIds: { $in: ids } }], ...(orgId ? { orgId } : {}) }).exec();
  }

  /**
   * Resolves the addresses a skill answers to: its Mongo `id`, a folded `aliasId`, and its human
   * `slug`. All are accepted because the UI holds ids while a prompt holds
   * `@agent-profile-specs:send-inbox`.
   */
  async findBySlugOrId(slugOrId: string, orgId?: string): Promise<SkillDocument | null> {
    if (!slugOrId) return null;
    return this.genericModel
      .findOne({ $or: [{ slug: slugOrId }, { id: slugOrId }, { aliasIds: slugOrId }], ...(orgId ? { orgId } : {}) })
      .exec();
  }

  /**
   * Bundles of the org, each with the index of its capabilities.
   *
   * Two queries regardless of how many bundles exist, and neither returns `content`: this feeds the
   * profile UI and the `## 4. Skills` section of the assembled context, where the whole point is that
   * the model sees *what it could ask for* without paying for the bodies.
   */
  async listCatalog(orgId: string): Promise<ISkillCatalogEntry[]> {
    const scope = orgId ? { orgId } : {};
    const [bundles, capabilities] = await Promise.all([
      this.genericModel.find({ ...scope, kind: 'bundle' }, METADATA_PROJECTION).sort({ name: 1 }).lean().exec(),
      this.genericModel.find({ ...scope, kind: 'capability' }, METADATA_PROJECTION).sort({ slug: 1 }).lean().exec(),
    ]);

    const byBundle = new Map<string, ISkillCatalogCapability[]>();
    for (const capability of capabilities as any[]) {
      const key = capability.bundleId || capability.bundleSlug;
      if (!key) continue;
      const entry: ISkillCatalogCapability = {
        id: capability.id,
        slug: capability.slug,
        name: capability.name,
        description: capability.description,
        type: capability.type,
        triggers: capability.triggers,
      };
      const existing = byBundle.get(key);
      if (existing) existing.push(entry);
      else byBundle.set(key, [entry]);
    }

    return (bundles as any[]).map(bundle => ({
      id: bundle.id,
      slug: bundle.slug,
      name: bundle.name,
      description: bundle.description,
      relPath: bundle.relPath,
      updatedAt: bundle.updatedAt,
      capabilities: byBundle.get(bundle.id) || byBundle.get(bundle.slug) || [],
    }));
  }

  /**
   * The granular fetch this whole task exists for.
   *
   * - a **capability** returns only the files that capability declared;
   * - a **bundle** returns `SKILL.md` plus the index of capabilities, so a model that guessed too
   *   broadly is told, in the same response, how to ask again more narrowly;
   * - `file` narrows further to a single embedded document.
   *
   * Scripts never travel as content — only their paths, because the ACP engines run with `cwd` on the
   * repo and executing from disk costs zero tokens.
   */
  async resolve(slugOrId: string, orgId?: string, file?: string): Promise<IResolvedSkill> {
    const skill = await this.findBySlugOrId(slugOrId, orgId);
    if (!skill) throw new NotFoundException(`Skill '${slugOrId}' not found`);

    const files: ISkillFile[] = (skill.files || []) as any[];
    const scripts = files.filter(entry => !entry.embedded).map(entry => entry.relPath);

    let content: string;
    if (file) {
      const match = files.find(entry => entry.relPath === file);
      if (!match) throw new NotFoundException(`File '${file}' is not part of skill '${skill.slug}'`);
      if (!match.embedded) {
        throw new NotFoundException(`File '${file}' is referenced by path only (not embedded) — read it from the workspace`);
      }
      content = match.content || '';
    } else {
      content = this.composeContent(skill);
    }

    const capabilities = skill.kind === 'bundle' ? await this.listCapabilitiesOf(skill, orgId) : undefined;

    return {
      id: skill.id,
      slug: skill.slug,
      kind: skill.kind,
      name: skill.name,
      description: skill.description,
      type: skill.type,
      relPath: skill.relPath,
      content,
      scripts,
      ...(capabilities ? { capabilities } : {}),
      ...(file ? { file } : {}),
    };
  }

  /**
   * Capability index for several bundles at once, keyed by bundle id.
   *
   * One query for the whole context assembly: `composeFullContext` runs on every chat turn and every
   * cron wake-up, so a per-skill lookup would multiply round-trips for what is a handful of rows.
   */
  async listCapabilitiesByBundleIds(bundleIds: string[], orgId?: string): Promise<Map<string, ISkillCatalogCapability[]>> {
    const grouped = new Map<string, ISkillCatalogCapability[]>();
    if (!bundleIds?.length) return grouped;

    const rows = await this.genericModel
      .find({ kind: 'capability', bundleId: { $in: bundleIds }, ...(orgId ? { orgId } : {}) }, METADATA_PROJECTION)
      .sort({ slug: 1 })
      .lean()
      .exec();

    for (const row of rows as any[]) {
      const entry: ISkillCatalogCapability = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        type: row.type,
        triggers: row.triggers,
      };
      const existing = grouped.get(row.bundleId);
      if (existing) existing.push(entry);
      else grouped.set(row.bundleId, [entry]);
    }
    return grouped;
  }

  private async listCapabilitiesOf(bundle: SkillDocument, orgId?: string): Promise<ISkillCatalogCapability[]> {
    const rows = await this.genericModel
      .find({ kind: 'capability', bundleId: bundle.id, ...(orgId ? { orgId } : {}) }, METADATA_PROJECTION)
      .sort({ slug: 1 })
      .lean()
      .exec();
    return (rows as any[]).map(row => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      type: row.type,
      triggers: row.triggers,
    }));
  }

  /**
   * Rebuilds the denormalized `content` from the embedded files.
   *
   * A **bundle** composes only its `instruction` file. Its `files[]` indexes the whole folder so any
   * document stays reachable through `?file=`, but concatenating all of them into `content` would
   * rebuild the very monolith this design breaks apart. A **capability** composes everything it
   * declared, because that subset *is* its instruction.
   *
   * Each file keeps its `relPath` as a comment when several are joined: the model has to be able to
   * tell them apart and cite where a rule came from. A single file is left bare so migrated documents
   * read exactly as they did in `sources`.
   */
  composeContent(skill: { kind?: ISkill['kind']; files?: ISkillFile[] }): string {
    const embedded = (skill.files || []).filter(entry => entry.embedded && entry.content);
    const selected = skill.kind === 'bundle' ? embedded.filter(entry => entry.role === 'instruction') : embedded;
    if (selected.length === 0) return '';
    if (selected.length === 1) return selected[0].content.trim();
    return selected.map(entry => `<!-- ${entry.relPath} -->\n\n${entry.content.trim()}`).join('\n\n---\n\n');
  }

  /**
   * Persists one skill folder: the bundle plus its atomic capabilities.
   *
   * Three properties the sync depends on:
   *
   * 1. **Upsert by `(orgId, slug)`, never by id.** The `.md` is the source of truth and may be synced
   *    from a machine that never saw the previous run, so identity comes from the address, not from
   *    an id the file might not carry.
   * 2. **`aliasIds` survive.** The migration folded historical duplicate ids into the bundle; a sync
   *    that overwrote the document would strand every profile still pointing at one of them.
   * 3. **Capabilities are reconciled, not appended.** A capability removed from the frontmatter has to
   *    disappear, or a stale slug would keep answering with content nobody maintains anymore.
   */
  async upsertBundle(payload: ISkillBundlePayload, orgId: string, workspaceId?: string): Promise<ISkillSyncResult> {
    const slug = payload?.slug;
    if (!slug) throw new Error('Skill bundle payload has no slug');

    const existing = await this.genericModel.findOne({ orgId, slug }).exec();
    const files = (payload.files || []).map(file => this.normalizeFile(file));

    const bundleFields: Partial<ISkill> = {
      orgId,
      kind: 'bundle',
      slug,
      name: payload.name,
      description: payload.description,
      files: files as any,
      content: this.composeContent({ kind: 'bundle', files }),
      workspaceId,
      relPath: payload.rootRelPath,
      enabled: true,
    };
    if (workspaceId && payload.rootRelPath) bundleFields.fingerprint = this.buildFingerprint(workspaceId, payload.rootRelPath);
    bundleFields.contentHash = crypto.createHash('sha256').update(bundleFields.content ?? '', 'utf8').digest('hex');

    const bundle = existing
      ? await this.genericModel.findOneAndUpdate({ _id: existing._id }, { $set: bundleFields }, { new: true }).exec()
      : await new this.genericModel(bundleFields).save();

    const bundleId = bundle.id || bundle._id?.toString();
    const capabilities = payload.capabilities || [];
    const keptSlugs: string[] = [];

    for (const capability of capabilities) {
      const capabilitySlug = `${slug}:${capability.slug}`;
      keptSlugs.push(capabilitySlug);
      const capabilityFiles = (capability.files || []).map(file => this.normalizeFile(file));
      const content = this.composeContent({ kind: 'capability', files: capabilityFiles });

      await this.genericModel
        .findOneAndUpdate(
          { orgId, slug: capabilitySlug },
          {
            $set: {
              orgId,
              kind: 'capability',
              slug: capabilitySlug,
              bundleId,
              bundleSlug: slug,
              name: capability.name,
              description: capability.description,
              type: capability.type,
              triggers: capability.triggers || [],
              files: capabilityFiles,
              content,
              workspaceId,
              relPath: payload.rootRelPath,
              contentHash: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
              enabled: true,
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .exec();
    }

    // Reconcile: whatever the frontmatter no longer declares stops existing.
    await this.genericModel.deleteMany({ orgId, kind: 'capability', bundleId, slug: { $nin: keptSlugs } }).exec();

    return { slug, skillId: bundleId, capabilities: capabilities.length, created: !existing };
  }

  /** A capability may only embed markdown; the CLI already enforces it, this is the server-side guard. */
  private normalizeFile(file: ISkillFile): ISkillFile {
    const embedded = !!file.embedded && typeof file.content === 'string';
    return {
      relPath: file.relPath,
      role: file.role,
      embedded,
      ...(embedded ? { content: file.content, contentHash: file.contentHash } : {}),
    };
  }

  private buildFingerprint(workspaceId: string, relPath: string): string {
    return crypto.createHash('sha256').update(`${workspaceId}:${relPath}`, 'utf8').digest('hex');
  }
}
