/**
 * KERNL MCP - Type Definitions
 * Version: 5.0.1
 * 
 * Core types for the persistent intelligence layer.
 * Foundation-first: Get types right, implementation follows.
 */

// ============================================================================
// PROJECT TYPES
// ============================================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  config: ProjectConfig;
  workspaceGroup?: string;
  visibility?: 'active' | 'archived' | 'hidden';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfig {
  /** Backlog configuration */
  backlog?: {
    indexPath: string;
    overviewPath: string;
    epicsDir: string;
  };
  /** File scanning configuration */
  fileScanning?: {
    enabled: boolean;
    mode: 'manual' | 'auto' | 'watcher';
    excludes: string[];
  };
  /** Git integration */
  git?: {
    enabled: boolean;
    autoCommit: boolean;
    messageTemplate: string;
  };
  /** Custom project-specific settings */
  custom?: Record<string, unknown>;
}

export interface WorkspaceGroup {
  id: string;
  description?: string;
  visibility?: 'expanded' | 'collapsed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// SESSION STATE TYPES
// ============================================================================

export interface SessionState {
  sessionId: string;
  projectId: string;
  currentTask: CurrentTask;
  context: SessionContext;
  updatedAt: string;
}

export interface CurrentTask {
  epic?: number;
  operation: string;
  progress: number; // 0.0 to 1.0
  startTime: string;
  decisions: string[];
  nextSteps: string[];
}

export interface SessionContext {
  activeFiles: string[];
  recentCommits: string[];
  knowledgeUsed: string[];
}

export interface ContinuationPrompt {
  prompt: string;
  summary: {
    lastAction: string;
    progress: number;
    nextSteps: string[];
    blockers: string[];
  };
}

export interface Checkpoint {
  id: number;
  projectId: string;
  sessionId?: string;
  operation?: string;
  progress: number;
  decisions?: string[];
  nextSteps?: string[];
  activeFiles?: string[];
  currentStep?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

// ============================================================================
// FILE OPERATION TYPES
// ============================================================================

export interface FileReadResult {
  path: string;
  content: string;
  size: number;
  encoding: string;
}

export interface FileWriteResult {
  path: string;
  size: number;
  success: boolean;
}

export interface FileSearchResult {
  path: string;
  matches: FileMatch[];
}

export interface FileMatch {
  line: number;
  content: string;
  context?: string;
}

export interface BatchReadResult {
  files: FileReadResult[];
  errors: Array<{ path: string; error: string }>;
}

export interface FileInfo {
  path: string;
  exists: boolean;
  size?: number;
  type?: 'file' | 'directory';
  modified?: string;
  created?: string;
}

// ============================================================================
// JOB QUEUE TYPES
// ============================================================================

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface Job {
  id: number;
  projectId: string;
  operation: string;
  parameters: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  currentStep?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobProgress {
  jobId: number;
  status: JobStatus;
  progress: number;
  currentStep: string;
  results?: unknown;
  error?: string;
  heartbeat: string;
}

// ============================================================================
// PATTERN/KNOWLEDGE TYPES
// ============================================================================

export interface Pattern {
  id: number;
  name: string;
  projectId: string;
  problem: string;
  solution: string;
  implementation?: string;
  metrics?: PatternMetrics;
  createdAt: string;
}

export interface PatternMetrics {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  improvement: string;
}

export interface PatternSuggestion {
  pattern: Pattern;
  originProject: string;
  problemSolved: string;
  implementation: string;
  confidence: number;
  effort: 'low' | 'medium' | 'high';
}

// ============================================================================
// BACKLOG/EPIC TYPES
// ============================================================================

export type EpicStatus = 'backlog' | 'in_progress' | 'complete' | 'blocked';
export type EpicPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface Epic {
  id: number;
  projectId: string;
  title: string;
  description?: string;
  status: EpicStatus;
  priority: EpicPriority;
  estimatedHours?: number;
  actualHours?: number;
  tags?: string[];
  dependencies?: string[];
  acceptanceCriteria?: string;
  specLocation?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ============================================================================
// GIT TYPES
// ============================================================================

export interface GitCommit {
  id: number;
  projectId: string;
  sessionId?: string;
  commitHash: string;
  message: string;
  filesChanged?: string[];
  stats?: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  createdAt: string;
}

// ============================================================================
// SHADOW DOCS TYPES
// ============================================================================

export interface ShadowDoc {
  id: number;
  projectId: string;
  filePath: string;
  content: string;
  commitWith: string;
  status: 'pending' | 'applied' | 'cancelled';
  createdAt: string;
  appliedAt?: string;
}

// ============================================================================
// RESEARCH TYPES
// ============================================================================

export interface Research {
  id: number;
  projectId: string;
  query: string;
  findings: Record<string, unknown>;
  sources?: string[];
  createdAt: string;
}

// ============================================================================
// SEMANTIC SEARCH TYPES
// ============================================================================

export interface SemanticSearchResult {
  path: string;
  content: string;
  score: number;
  preview?: string;
}

export interface IndexStatus {
  projectId: string;
  totalFiles: number;
  indexedFiles: number;
  lastIndexed?: string;
  isComplete: boolean;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface ToolError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ToolResult<T> = 
  | { success: true; data: T }
  | { success: false; error: ToolError };

// ============================================================================
// MCP TOOL DEFINITION HELPERS
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

// ============================================================================
// TOOL INPUT TYPES
// ============================================================================

// State Management
export interface GetSessionStateInput {
  project: string;
}

export interface SaveSessionStateInput {
  project: string;
  currentTask: CurrentTask;
  context: SessionContext;
}

export interface AutoCheckpointInput {
  project: string;
  operation?: string;
  progress?: number;
  decisions?: string[];
  nextSteps?: string[];
  activeFiles?: string[];
  currentStep?: string;
}

export interface MarkCompleteInput {
  project: string;
  summary?: string;
}

// File Operations
export interface ReadFileInput {
  project: string;
  path: string;
  encoding?: string;
}

export interface WriteFileInput {
  project: string;
  path: string;
  content: string;
  encoding?: string;
}

export interface SearchFilesInput {
  project: string;
  pattern: string;
  path?: string;
  maxResults?: number;
}

export interface BatchReadInput {
  project: string;
  paths: string[];
}

// Project Operations
export interface RegisterProjectInput {
  id: string;
  name: string;
  path: string;
  config?: Partial<ProjectConfig>;
  workspaceGroup?: string;
}

export interface GetProjectInput {
  project: string;
}

// Intelligence
export interface SemanticSearchInput {
  project: string;
  query: string;
  limit?: number;
}

export interface IndexFilesInput {
  project: string;
  force?: boolean;
}

// Backlog
export interface QueryBacklogInput {
  project: string;
  status?: EpicStatus;
  priority?: EpicPriority;
}

export interface AddEpicInput {
  project: string;
  title: string;
  description?: string;
  priority?: EpicPriority;
  estimatedHours?: number;
}

// Git
export interface SmartCommitInput {
  project: string;
  type?: 'feat' | 'fix' | 'docs' | 'refactor' | 'test' | 'chore';
  message?: string;
  scope?: string;
  verifyBuild?: boolean;
  applyShadowDocs?: boolean;
  stageAll?: boolean;
}

// Shadow Docs
export interface ShadowDocUpdateInput {
  project: string;
  file: string;
  content: string;
  commitWith?: string;
}
