/** Legacy profile-link inspection shared by the disk materializer and runtime resolver. */
/** Profile-private package links projected into its pnpm-managed node_modules. */
export declare const PROFILE_MODULE_FALLBACK_DIR = ".dsh-module-fallback";
/**
 * Return whether the process reads application modules from pkg's virtual filesystem.
 * @returns whether pkg owns the module filesystem.
 */
export declare function isPackagedExecutable(): boolean;
/**
 * Resolve a directory through the active carrier's filesystem implementation.
 * @param path - directory path to canonicalize.
 * @returns the canonical directory path.
 */
export declare function realModuleDirectory(path: string): string;
/**
 * Resolve a link target without following the final path component.
 * @param path - candidate path whose parent is canonicalized.
 * @returns the canonical candidate, or undefined when its parent is absent.
 */
export declare function canonicalLinkPath(path: string): string | undefined;
/**
 * Return whether a symlink or junction points at the same path as `target`.
 * @param link - symlink or junction to inspect.
 * @param target - expected target path.
 * @returns whether both paths identify the same entry.
 */
export declare function symlinkPointsTo(link: string, target: string): boolean;
/**
 * Return whether an observed profile package must not claim local precedence.
 * @param profileDir - profile directory containing the package projection.
 * @param packageName - bare package name to inspect.
 * @returns whether the entry is a managed fallback link or disappeared during inspection.
 */
export declare function isProfileModuleFallbackLink(profileDir: string, packageName: string): boolean;
//# sourceMappingURL=legacy-links.d.ts.map