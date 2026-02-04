import fs from "fs";
import path from "path";

/**
 * Finds node_modules directories by walking up from startDir,
 * then up from vaultRoot. Used by both bundler and language service.
 */
export function findNodeModulesPaths(
  vaultRoot: string,
  startDir: string = vaultRoot,
): string[] {
  const paths: string[] = [];
  let current = startDir;

  while (current.startsWith(vaultRoot)) {
    const candidate = path.join(current, "node_modules");
    if (fs.existsSync(candidate)) {
      paths.push(candidate);
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const rootNodeModules = path.join(vaultRoot, "node_modules");
  if (fs.existsSync(rootNodeModules) && !paths.includes(rootNodeModules)) {
    paths.push(rootNodeModules);
  }

  current = vaultRoot;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) break;
    const candidate = path.join(parent, "node_modules");
    if (fs.existsSync(candidate) && !paths.includes(candidate)) {
      paths.push(candidate);
      break;
    }
    current = parent;
  }
  return paths;
}
