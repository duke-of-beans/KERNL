/**
 * KERNL MCP - Database Layer
 * Version: 5.0.1
 *
 * SQLite database for persistent state management.
 */
import type { Project, SessionState, CurrentTask, SessionContext, Epic, EpicStatus, EpicPriority, ShadowDoc, Checkpoint } from '../types/index.js';
export declare class ProjectDatabase {
    private db;
    constructor(dbPath: string);
    private initialize;
    private runMigrations;
    createProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project;
    getProject(id: string): Project | null;
    listProjects(): Project[];
    updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'path' | 'config' | 'workspaceGroup' | 'visibility' | 'notes'>>): boolean;
    deleteProject(id: string): boolean;
    saveSession(projectId: string, sessionId: string, state: {
        currentTask: CurrentTask;
        context: SessionContext;
    }): SessionState;
    getLatestSession(projectId: string): SessionState | null;
    deleteSession(sessionId: string): boolean;
    saveCheckpoint(checkpoint: Omit<Checkpoint, 'id' | 'createdAt'>): Checkpoint;
    getLatestCheckpoint(projectId: string): Checkpoint | null;
    indexFile(projectId: string, path: string, fileType: string | null, size: number, contentHash: string, contentPreview: string, embedding: Buffer | null, metadata?: Record<string, unknown>): number;
    getFileIndex(projectId: string, path: string): FileIndexRow | null;
    getProjectFiles(projectId: string): FileIndexRow[];
    searchFilesByEmbedding(projectId: string, queryEmbedding: Buffer, limit?: number): Array<FileIndexRow & {
        score: number;
    }>;
    createEpic(epic: Omit<Epic, 'id' | 'createdAt' | 'updatedAt'>): Epic;
    getEpics(projectId: string, status?: EpicStatus, priority?: EpicPriority): Epic[];
    updateEpic(id: number, updates: Partial<Epic>): boolean;
    createShadowDoc(doc: Omit<ShadowDoc, 'id' | 'createdAt' | 'status'>): ShadowDoc;
    getPendingShadowDocs(projectId: string): ShadowDoc[];
    applyShadowDoc(id: number): boolean;
    cancelShadowDoc(id: number): boolean;
    logActivity(action: string, details?: Record<string, unknown>, projectId?: string, sessionId?: string): void;
    close(): void;
}
interface FileIndexRow {
    id: number;
    project_id: string;
    path: string;
    file_type: string | null;
    size: number;
    content_hash: string;
    content_preview: string | null;
    embedding: Buffer | null;
    metadata: string;
    indexed_at: string;
}
export {};
//# sourceMappingURL=database.d.ts.map