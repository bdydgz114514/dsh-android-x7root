/** Package metadata resolved through one profile resolution registration. */
import { Service, type Context } from '@deepseek-ai/cordis';
import { type ProfileResolutionBehavior } from './resolver.ts';
import type { ProfileResolutionGeneration } from '../profile.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Deterministic package lookup for configured plugin specifiers. */
        pluginPackages: PluginPackages;
    }
}
/** The package that owns a resolved module. */
export interface PluginPackage {
    /** Manifest package name. */
    name: string;
    /** Manifest version when declared. */
    version: string | undefined;
    /** Absolute package directory. */
    dir: string;
    /** Absolute package.json path. */
    manifestPath: string;
    /** Parsed manifest shared by metadata readers. */
    manifest: Record<string, unknown>;
}
/** Optional runtime resolver installed and owned by {@link PluginPackages}. */
export interface PluginPackagesConfig {
    /** Complete package table; omit it to expose native package lookup only. */
    generation?: ProfileResolutionGeneration;
    /** Enforce the table or compare it with a materialized fallback. */
    behavior?: ProfileResolutionBehavior;
}
/** Package lookup shared by metadata consumers in one profile process. */
export declare class PluginPackages extends Service {
    private packages;
    private readonly resolver;
    private readonly behavior;
    private disposeWorkerResolution;
    constructor(ctx: Context, config?: PluginPackagesConfig);
    /**
     * Publish an additive generation for this process and subsequently created Workers.
     * @param generation - fully constructed successor generation.
     */
    replace(generation: ProfileResolutionGeneration): void;
    /**
     * Locate the package named by a specifier without requiring a package export.
     * @param specifier - module specifier whose package owns the requested module.
     * @param parentURL - URL whose Node lookup order applies.
     * @returns the parsed package, or undefined when no package owns the request.
     */
    packageOf(specifier: string, parentURL: string): PluginPackage | undefined;
}
//# sourceMappingURL=service.d.ts.map