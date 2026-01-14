/**
 * KERNL - Project Operations Tools
 */
import type { ProjectDatabase } from '../storage/database.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectConfig } from '../types/index.js';
export declare const projectOperationsTools: Tool[];
export declare function createProjectOperationsHandlers(db: ProjectDatabase): {
    pm_register_project: (input: {
        id: string;
        name: string;
        path: string;
        config?: ProjectConfig;
        group?: string;
    }) => Promise<{
        error: string;
        success?: undefined;
        project?: undefined;
    } | {
        success: boolean;
        project: import("../types/index.js").Project;
        error?: undefined;
    }>;
    pm_list_projects: (_input: {
        group?: string;
        visibility?: string;
    }) => Promise<{
        count: number;
        projects: {
            id: string;
            name: string;
            path: string;
            group: string | undefined;
            visibility: "active" | "archived" | "hidden" | undefined;
        }[];
    }>;
    pm_get_project: (input: {
        project: string;
    }) => Promise<{
        error: string;
        project?: undefined;
    } | {
        project: import("../types/index.js").Project;
        error?: undefined;
    }>;
    pm_update_project: (input: {
        project: string;
        name?: string;
        config?: ProjectConfig;
        group?: string;
        visibility?: "active" | "archived" | "hidden";
        notes?: string;
    }) => Promise<{
        error: string;
        success?: undefined;
        project?: undefined;
    } | {
        success: boolean;
        project: import("../types/index.js").Project | null;
        error?: undefined;
    }>;
    pm_delete_project: (input: {
        project: string;
    }) => Promise<{
        error: string;
        success?: undefined;
        message?: undefined;
    } | {
        success: boolean;
        message: string;
        error?: undefined;
    }>;
};
//# sourceMappingURL=project-operations.d.ts.map