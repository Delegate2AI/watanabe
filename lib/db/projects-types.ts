/**
 * Shared types for the projects model (spec 26). Kept separate from
 * `lib/db/projects.ts` so the query module stays under the file-size gate.
 */

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  context: string | null;
  clearance: string[];
  ownerEmail: string;
  createdAt: string;
}

export interface NewProject {
  id: string;
  name: string;
  description: string | null;
  context: string | null;
  clearance: string[];
  ownerEmail: string;
  createdAt: string;
}

export interface ProjectSummary {
  project: ProjectRecord;
  threadCount: number;
  taskCount: number;
  lastActivity: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  context: string | null;
  clearance: string;
  owner_email: string;
  created_at: string;
}
