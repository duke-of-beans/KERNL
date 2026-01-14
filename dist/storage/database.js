/**
 * KERNL MCP - Database Layer
 * Version: 5.0.1
 *
 * SQLite database for persistent state management.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import BetterSqlite3 from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// ============================================================================
// DATABASE CLASS
// ============================================================================
export class ProjectDatabase {
    db; // better-sqlite3 Database instance
    constructor(dbPath) {
        // Ensure directory exists
        const dir = dirname(dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        this.db = BetterSqlite3(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.initialize();
    }
    initialize() {
        // Load and execute main schema
        const schemaPath = join(__dirname, 'schema.sql');
        if (existsSync(schemaPath)) {
            const schema = readFileSync(schemaPath, 'utf8');
            this.db.exec(schema);
        }
        // Load and execute Chrome schema
        const chromeSchemaPath = join(__dirname, 'chrome-schema.sql');
        if (existsSync(chromeSchemaPath)) {
            const chromeSchema = readFileSync(chromeSchemaPath, 'utf8');
            this.db.exec(chromeSchema);
        }
        this.runMigrations();
    }
    runMigrations() {
        // Migration: Add embedding column if missing
        try {
            const tableInfo = this.db.prepare("PRAGMA table_info(file_index)").all();
            const hasEmbedding = tableInfo.some(col => col.name === 'embedding');
            if (!hasEmbedding) {
                this.db.exec("ALTER TABLE file_index ADD COLUMN embedding BLOB");
            }
            const hasContentPreview = tableInfo.some(col => col.name === 'content_preview');
            if (!hasContentPreview) {
                this.db.exec("ALTER TABLE file_index ADD COLUMN content_preview TEXT");
            }
        }
        catch {
            // Table might not exist yet
        }
    }
    // ==========================================================================
    // PROJECT OPERATIONS
    // ==========================================================================
    createProject(project) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, path, config, workspace_group, visibility, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(project.id, project.name, project.path, JSON.stringify(project.config || {}), project.workspaceGroup || null, project.visibility || 'active', project.notes || null, now, now);
        return { ...project, config: project.config || {}, createdAt: now, updatedAt: now };
    }
    getProject(id) {
        const stmt = this.db.prepare(`SELECT * FROM projects WHERE id = ?`);
        const row = stmt.get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            name: row.name,
            path: row.path,
            config: JSON.parse(row.config || '{}'),
            workspaceGroup: row.workspace_group || undefined,
            visibility: row.visibility || 'active',
            notes: row.notes || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    listProjects() {
        const stmt = this.db.prepare(`SELECT * FROM projects ORDER BY name`);
        const rows = stmt.all();
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            path: row.path,
            config: JSON.parse(row.config || '{}'),
            workspaceGroup: row.workspace_group || undefined,
            visibility: row.visibility || 'active',
            notes: row.notes || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }
    updateProject(id, updates) {
        const parts = [];
        const values = [];
        if (updates.name !== undefined) {
            parts.push('name = ?');
            values.push(updates.name);
        }
        if (updates.path !== undefined) {
            parts.push('path = ?');
            values.push(updates.path);
        }
        if (updates.config !== undefined) {
            parts.push('config = ?');
            values.push(JSON.stringify(updates.config));
        }
        if (updates.workspaceGroup !== undefined) {
            parts.push('workspace_group = ?');
            values.push(updates.workspaceGroup);
        }
        if (updates.visibility !== undefined) {
            parts.push('visibility = ?');
            values.push(updates.visibility);
        }
        if (updates.notes !== undefined) {
            parts.push('notes = ?');
            values.push(updates.notes);
        }
        if (parts.length === 0)
            return false;
        parts.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        const stmt = this.db.prepare(`UPDATE projects SET ${parts.join(', ')} WHERE id = ?`);
        const result = stmt.run(...values);
        return result.changes > 0;
    }
    deleteProject(id) {
        const stmt = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
        const result = stmt.run(id);
        return result.changes > 0;
    }
    // ==========================================================================
    // SESSION OPERATIONS
    // ==========================================================================
    saveSession(projectId, sessionId, state) {
        const now = new Date().toISOString();
        const stateJson = JSON.stringify(state);
        const stmt = this.db.prepare(`
      INSERT INTO sessions (id, project_id, state, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at
    `);
        stmt.run(sessionId, projectId, stateJson, now);
        return {
            sessionId,
            projectId,
            currentTask: state.currentTask,
            context: state.context,
            updatedAt: now,
        };
    }
    getLatestSession(projectId) {
        const stmt = this.db.prepare(`
      SELECT * FROM sessions 
      WHERE project_id = ? 
      ORDER BY updated_at DESC 
      LIMIT 1
    `);
        const row = stmt.get(projectId);
        if (!row)
            return null;
        const state = JSON.parse(row.state);
        return {
            sessionId: row.id,
            projectId: row.project_id,
            currentTask: state.currentTask,
            context: state.context,
            updatedAt: row.updated_at,
        };
    }
    deleteSession(sessionId) {
        const stmt = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);
        const result = stmt.run(sessionId);
        return result.changes > 0;
    }
    // ==========================================================================
    // CHECKPOINT OPERATIONS
    // ==========================================================================
    saveCheckpoint(checkpoint) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO checkpoints (project_id, session_id, operation, progress, decisions, next_steps, active_files, current_step, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(checkpoint.projectId, checkpoint.sessionId || null, checkpoint.operation || null, checkpoint.progress || 0, checkpoint.decisions ? JSON.stringify(checkpoint.decisions) : null, checkpoint.nextSteps ? JSON.stringify(checkpoint.nextSteps) : null, checkpoint.activeFiles ? JSON.stringify(checkpoint.activeFiles) : null, checkpoint.currentStep || null, checkpoint.data ? JSON.stringify(checkpoint.data) : null, now);
        return {
            ...checkpoint,
            id: result.lastInsertRowid,
            createdAt: now,
        };
    }
    getLatestCheckpoint(projectId) {
        const stmt = this.db.prepare(`
      SELECT * FROM checkpoints 
      WHERE project_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
        const row = stmt.get(projectId);
        if (!row)
            return null;
        return {
            id: row.id,
            projectId: row.project_id,
            sessionId: row.session_id || undefined,
            operation: row.operation || undefined,
            progress: row.progress,
            decisions: row.decisions ? JSON.parse(row.decisions) : undefined,
            nextSteps: row.next_steps ? JSON.parse(row.next_steps) : undefined,
            activeFiles: row.active_files ? JSON.parse(row.active_files) : undefined,
            currentStep: row.current_step || undefined,
            data: row.data ? JSON.parse(row.data) : undefined,
            createdAt: row.created_at,
        };
    }
    // ==========================================================================
    // FILE INDEX OPERATIONS
    // ==========================================================================
    indexFile(projectId, path, fileType, size, contentHash, contentPreview, embedding, metadata = {}) {
        const stmt = this.db.prepare(`
      INSERT INTO file_index (project_id, path, file_type, size, content_hash, content_preview, embedding, metadata, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, path) DO UPDATE SET
        file_type = excluded.file_type,
        size = excluded.size,
        content_hash = excluded.content_hash,
        content_preview = excluded.content_preview,
        embedding = excluded.embedding,
        metadata = excluded.metadata,
        indexed_at = excluded.indexed_at
    `);
        const result = stmt.run(projectId, path, fileType, size, contentHash, contentPreview, embedding, JSON.stringify(metadata), new Date().toISOString());
        return result.lastInsertRowid;
    }
    getFileIndex(projectId, path) {
        const stmt = this.db.prepare(`SELECT * FROM file_index WHERE project_id = ? AND path = ?`);
        return stmt.get(projectId, path) ?? null;
    }
    getProjectFiles(projectId) {
        const stmt = this.db.prepare(`SELECT * FROM file_index WHERE project_id = ?`);
        return stmt.all(projectId);
    }
    searchFilesByEmbedding(projectId, queryEmbedding, limit = 10) {
        // SQLite doesn't have native vector similarity, so we fetch all and compute in JS
        const stmt = this.db.prepare(`
      SELECT * FROM file_index 
      WHERE project_id = ? AND embedding IS NOT NULL
    `);
        const files = stmt.all(projectId);
        const queryVector = new Float32Array(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.length / 4);
        const scored = files.map(file => {
            if (!file.embedding)
                return { ...file, score: 0 };
            const fileVector = new Float32Array(file.embedding.buffer, file.embedding.byteOffset, file.embedding.length / 4);
            const score = cosineSimilarity(queryVector, fileVector);
            return { ...file, score };
        });
        return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    // ==========================================================================
    // EPIC/BACKLOG OPERATIONS
    // ==========================================================================
    createEpic(epic) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO epics (project_id, title, description, status, priority, estimated_hours, actual_hours, tags, dependencies, acceptance_criteria, spec_location, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(epic.projectId, epic.title, epic.description || null, epic.status || 'backlog', epic.priority || 'P2', epic.estimatedHours || null, epic.actualHours || null, epic.tags ? JSON.stringify(epic.tags) : null, epic.dependencies ? JSON.stringify(epic.dependencies) : null, epic.acceptanceCriteria || null, epic.specLocation || null, now, now);
        return {
            ...epic,
            id: result.lastInsertRowid,
            status: epic.status || 'backlog',
            priority: epic.priority || 'P2',
            createdAt: now,
            updatedAt: now,
        };
    }
    getEpics(projectId, status, priority) {
        let query = `SELECT * FROM epics WHERE project_id = ?`;
        const params = [projectId];
        if (status) {
            query += ` AND status = ?`;
            params.push(status);
        }
        if (priority) {
            query += ` AND priority = ?`;
            params.push(priority);
        }
        query += ` ORDER BY priority, created_at`;
        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params);
        return rows.map(row => ({
            id: row.id,
            projectId: row.project_id,
            title: row.title,
            description: row.description || undefined,
            status: row.status,
            priority: row.priority,
            estimatedHours: row.estimated_hours || undefined,
            actualHours: row.actual_hours || undefined,
            tags: row.tags ? JSON.parse(row.tags) : undefined,
            dependencies: row.dependencies ? JSON.parse(row.dependencies) : undefined,
            acceptanceCriteria: row.acceptance_criteria || undefined,
            specLocation: row.spec_location || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at || undefined,
        }));
    }
    updateEpic(id, updates) {
        const parts = [];
        const values = [];
        if (updates.status !== undefined) {
            parts.push('status = ?');
            values.push(updates.status);
            if (updates.status === 'complete') {
                parts.push('completed_at = ?');
                values.push(new Date().toISOString());
            }
        }
        if (updates.actualHours !== undefined) {
            parts.push('actual_hours = ?');
            values.push(updates.actualHours);
        }
        if (parts.length === 0)
            return false;
        parts.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        const stmt = this.db.prepare(`UPDATE epics SET ${parts.join(', ')} WHERE id = ?`);
        const result = stmt.run(...values);
        return result.changes > 0;
    }
    // ==========================================================================
    // SHADOW DOCS OPERATIONS
    // ==========================================================================
    createShadowDoc(doc) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO shadow_docs (project_id, file_path, content, commit_with, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
        const result = stmt.run(doc.projectId, doc.filePath, doc.content, doc.commitWith || 'next_code_commit', now);
        return {
            ...doc,
            id: result.lastInsertRowid,
            status: 'pending',
            commitWith: doc.commitWith || 'next_code_commit',
            createdAt: now,
        };
    }
    getPendingShadowDocs(projectId) {
        const stmt = this.db.prepare(`
      SELECT * FROM shadow_docs 
      WHERE project_id = ? AND status = 'pending'
      ORDER BY created_at
    `);
        const rows = stmt.all(projectId);
        return rows.map(row => ({
            id: row.id,
            projectId: row.project_id,
            filePath: row.file_path,
            content: row.content,
            commitWith: row.commit_with,
            status: row.status,
            createdAt: row.created_at,
            appliedAt: row.applied_at || undefined,
        }));
    }
    applyShadowDoc(id) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      UPDATE shadow_docs SET status = 'applied', applied_at = ? WHERE id = ?
    `);
        const result = stmt.run(now, id);
        return result.changes > 0;
    }
    cancelShadowDoc(id) {
        const stmt = this.db.prepare(`
      UPDATE shadow_docs SET status = 'cancelled' WHERE id = ?
    `);
        const result = stmt.run(id);
        return result.changes > 0;
    }
    // ==========================================================================
    // ACTIVITY LOG
    // ==========================================================================
    logActivity(action, details, projectId, sessionId) {
        const stmt = this.db.prepare(`
      INSERT INTO activity_log (project_id, action, details, timestamp)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(projectId || null, action, details ? JSON.stringify(details) : null, new Date().toISOString());
    }
    // ==========================================================================
    // CLEANUP
    // ==========================================================================
    close() {
        this.db.close();
    }
}
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}
//# sourceMappingURL=database.js.map