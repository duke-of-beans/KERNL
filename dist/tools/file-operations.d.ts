/**
 * KERNL - File Operations Tools
 * Project-aware file read/write/search
 */
import type { ProjectDatabase } from '../storage/database.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const fileOperationsTools: Tool[];
export declare function createFileOperationsHandlers(db: ProjectDatabase): {
    pm_read_file: (input: {
        project: string;
        path: string;
        offset?: number;
        length?: number;
    }) => Promise<{
        content: string;
        totalLines: number;
        range: {
            start: number;
            end: number;
        };
        error?: undefined;
    } | {
        content: string;
        totalLines?: undefined;
        range?: undefined;
        error?: undefined;
    } | {
        error: string;
        content?: undefined;
        totalLines?: undefined;
        range?: undefined;
    }>;
    pm_write_file: (input: {
        project: string;
        path: string;
        content: string;
        mode?: "rewrite" | "append";
    }) => Promise<{
        success: boolean;
        path: string;
        error?: undefined;
    } | {
        error: string;
        success?: undefined;
        path?: undefined;
    }>;
    pm_search_files: (input: {
        project: string;
        pattern: string;
        contentSearch?: string;
        maxResults?: number;
    }) => Promise<{
        error: string;
        count?: undefined;
        results?: undefined;
    } | {
        count: number;
        results: {
            path: string;
            name: string;
            size: number | undefined;
        }[];
        error?: undefined;
    }>;
    pm_list_files: (input: {
        project: string;
        path?: string;
        recursive?: boolean;
        extensions?: string[];
    }) => Promise<{
        error: string;
        count?: undefined;
        files?: undefined;
    } | {
        count: number;
        files: {
            path: string;
            name: string;
            type: "file" | "directory";
            size: number | undefined;
            extension: string | undefined;
        }[];
        error?: undefined;
    }>;
    pm_batch_read: (input: {
        project: string;
        paths: string[];
    }) => Promise<{
        results: Record<string, {
            content?: string;
            error?: string;
        }>;
    }>;
    pm_get_file_info: (input: {
        project: string;
        path: string;
    }) => Promise<{
        path: string;
        name: string;
        size: number;
        isDirectory: boolean;
        modifiedAt: string;
        error?: undefined;
    } | {
        error: string;
        path?: undefined;
        name?: undefined;
        size?: undefined;
        isDirectory?: undefined;
        modifiedAt?: undefined;
    }>;
};
//# sourceMappingURL=file-operations.d.ts.map