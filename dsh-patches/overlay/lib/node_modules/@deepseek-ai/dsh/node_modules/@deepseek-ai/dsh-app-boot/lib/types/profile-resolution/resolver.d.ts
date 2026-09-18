/** In-memory profile package routing for Node's default ESM and CommonJS loaders. */
import type { ProfileResolutionGeneration } from '../profile.ts';
/** Whether runtime resolution redirects requests or verifies the materialized backend. */
export type ProfileResolutionBehavior = 'enforce' | 'verify';
/** Active resolver registration in one Node isolate. */
export interface ProfileResolutionRegistration {
    /**
     * Locate a bare package without requiring one of its exports.
     * @param specifier - bare package or package-subpath specifier.
     * @param parentURL - file URL whose lookup order applies.
     * @returns selected package directory, or undefined when it is absent.
     */
    packageDir(specifier: string, parentURL: string): string | undefined;
    /**
     * Atomically publish an additive package table and fresh generation-owned caches.
     * @param generation - fully constructed successor generation.
     * @throws when the profile scope or an existing package mapping changes.
     */
    replace(generation: ProfileResolutionGeneration): void;
    /** Restore the native resolver methods. Registrations dispose in reverse order. */
    dispose(): void;
}
/**
 * Split a bare request into its package name without allocating path segments.
 * @param request - module specifier to classify.
 * @returns the bare package name, or undefined for non-package requests.
 */
export declare function barePackageName(request: string): string | undefined;
/**
 * Install one profile generation on Node's default ESM and CommonJS resolvers.
 * @param generation - complete package table and profile scope.
 * @param behavior - enforce the generation, or verify a materialized generation.
 * @returns a registration that replaces the generation or restores the native methods.
 */
export declare function installProfileResolution(generation: ProfileResolutionGeneration, behavior?: ProfileResolutionBehavior): ProfileResolutionRegistration;
/**
 * Publish one generation for Harness-owned Workers.
 * @param generation - complete package table and profile scope.
 * @param behavior - enforce or verify the generation in newly created Workers.
 * @returns a disposer restoring the previous thread environment data.
 */
export declare function registerWorkerResolution(generation: ProfileResolutionGeneration, behavior?: ProfileResolutionBehavior): () => void;
//# sourceMappingURL=resolver.d.ts.map