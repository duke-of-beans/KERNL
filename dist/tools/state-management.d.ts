/**
 * KERNL - State Management Tools
 * Session state, checkpoints, and crash recovery
 */
import type { ProjectDatabase } from '../storage/database.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const stateManagementTools: Tool[];
export declare function createStateManagementHandlers(db: ProjectDatabase): {
    get_session_context: (input: {
        project: string;
        mode?: string;
    }) => Promise<{
        error: string;
        needsResume?: undefined;
        checkpoint?: undefined;
        project?: undefined;
        mode?: undefined;
    } | {
        needsResume: boolean;
        checkpoint: {
            operation: string | undefined;
            progress: number;
            decisions: string[] | undefined;
            nextSteps: string[] | undefined;
            activeFiles: string[] | undefined;
            createdAt: string;
        } | null;
        project: {
            id: string;
            name: string;
            path: string;
        };
        mode: string;
        error?: undefined;
    }>;
    check_resume_needed: (input: {
        project: string;
    }) => Promise<{
        needsResume: boolean;
        checkpoint?: undefined;
        createdAt?: undefined;
    } | {
        needsResume: boolean;
        checkpoint: {
            operation: string | undefined;
            progress: number;
            decisions: string[] | undefined;
            nextSteps: string[] | undefined;
        };
        createdAt: string;
    }>;
    auto_checkpoint: (input: {
        project: string;
        operation: string;
        progress?: number;
        decisions?: string[];
        nextSteps?: string[];
        activeFiles?: string[];
        currentStep?: string;
    }) => Promise<{
        success: boolean;
        message: string;
    }>;
    mark_complete: (input: {
        project: string;
        summary?: string;
    }) => Promise<{
        success: boolean;
        message: string;
    }>;
};
//# sourceMappingURL=state-management.d.ts.map