import { IAuditable } from '@dataclouder/nest-core';

/**
 * Workspace (project) registry — universal sync contract (Fase 1.5).
 * A workspace is a root project (e.g. control-markets, arkham) that owns a wiki,
 * agent profiles and synced markdown files. The physical root path is NOT stored
 * here (it is machine-specific): each host maps slug → rootPath in its local
 * `~/.control-markets/workspaces.json` registry.
 */
export interface IWorkspace {
  _id?: string;
  id?: string;
  orgId?: string;
  /** Stable identifier used inside fingerprints — never rename lightly */
  slug?: string;
  name?: string;
  description?: string;
  /** Where the wiki lives inside the workspace root, e.g. 'control-markets-wiki' */
  wikiSubdir?: string;
  /** Agents directory inside the wiki, defaults to '12-agents' */
  agentsDir?: string;
  auditable?: IAuditable;
}
