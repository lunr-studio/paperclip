import fs from "node:fs";
import path from "node:path";

export function resolveManagedInstallPackageDir(localPluginDir: string, packageName: string): string {
  if (packageName.startsWith("@")) {
    return path.join(localPluginDir, "node_modules", ...packageName.split("/"));
  }
  return path.join(localPluginDir, "node_modules", packageName);
}

export function isPathInsideDir(candidatePath: string, parentDir: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedParent = path.resolve(parentDir);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function listPluginPackageRootCandidates(
  localPluginDir: string,
  packageName: string,
  packagePath?: string | null,
): string[] {
  const candidates = new Set<string>();

  if (packagePath) {
    candidates.add(path.resolve(packagePath));
  }

  candidates.add(resolveManagedInstallPackageDir(localPluginDir, packageName));
  candidates.add(path.join(localPluginDir, packageName));

  return [...candidates];
}

export function resolveContainedPluginEntrypoint(
  packageRoot: string,
  entrypointPath: string,
): string | null {
  const resolvedPackageRoot = path.resolve(packageRoot);
  if (!fs.existsSync(resolvedPackageRoot)) {
    return null;
  }

  const resolvedEntrypoint = path.resolve(resolvedPackageRoot, entrypointPath);
  if (!isPathInsideDir(resolvedEntrypoint, resolvedPackageRoot)) {
    return null;
  }

  if (!fs.existsSync(resolvedEntrypoint)) {
    return null;
  }

  try {
    const realPackageRoot = fs.realpathSync(resolvedPackageRoot);
    const realEntrypoint = fs.realpathSync(resolvedEntrypoint);
    if (!isPathInsideDir(realEntrypoint, realPackageRoot)) {
      return null;
    }
  } catch {
    return null;
  }

  return resolvedEntrypoint;
}

export function resolvePluginPackageEntrypoint(
  localPluginDir: string,
  packageName: string,
  entrypointPath: string,
  packagePath?: string | null,
): string | null {
  for (const packageRoot of listPluginPackageRootCandidates(localPluginDir, packageName, packagePath)) {
    const entrypoint = resolveContainedPluginEntrypoint(packageRoot, entrypointPath);
    if (entrypoint) {
      return entrypoint;
    }
  }
  return null;
}
