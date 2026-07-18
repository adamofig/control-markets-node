import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkspaceEntity, WorkspaceDocument } from '../schemas/workspace.schema';
import { MongoService, EntityCommunicationService } from '@dataclouder/nest-mongo';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Per-host registry mapping workspace slug → physical root path.
 * Lives outside the DB on purpose: paths belong to each machine, not to the org. */
const LOCAL_REGISTRY_PATH = path.join(os.homedir(), '.control-markets', 'workspaces.json');

@Injectable()
export class WorkspaceService extends EntityCommunicationService<WorkspaceDocument> {
  constructor(
    @InjectModel(WorkspaceEntity.name)
    workspaceModel: Model<WorkspaceDocument>,
    mongoService: MongoService,
  ) {
    super(workspaceModel, mongoService);
  }

  /** Reads the host-local registry (`~/.control-markets/workspaces.json`). Returns {} if absent. */
  readLocalRegistry(): Record<string, string> {
    try {
      if (!fs.existsSync(LOCAL_REGISTRY_PATH)) return {};
      return JSON.parse(fs.readFileSync(LOCAL_REGISTRY_PATH, 'utf-8'));
    } catch (err) {
      console.warn(`Could not read workspace registry at ${LOCAL_REGISTRY_PATH}: ${err.message}`);
      return {};
    }
  }

  /** Resolves the physical root path of a workspace slug on THIS host, or null if not registered/existing. */
  resolveRootForHost(slug: string): string | null {
    if (!slug) return null;
    const rootPath = this.readLocalRegistry()[slug];
    if (!rootPath || !fs.existsSync(rootPath)) return null;
    return rootPath;
  }
}
