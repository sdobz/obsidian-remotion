/**
 * Extract imported module names from source code
 */
export function extractImportedModules(code: string): Set<string> {
    const modules = new Set<string>();

    // Match: import ... from 'module' or import ... from "module"
    const importRegex = /import\s+(?:type\s+)?(?:(?:\*\s+as\s+\w+)|(?:{[^}]*})|(?:\w+(?:\s*,\s*{[^}]*})?)|(?:\w+))\s+from\s+['"]([@\w/.-]+)['"]/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
        modules.add(match[1]);
    }

    // Match: require('module') or require("module")
    const requireRegex = /require\s*\(\s*['"]([@\w/.-]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(code)) !== null) {
        modules.add(match[1]);
    }

    // Match: import('module') - dynamic imports
    const dynamicRegex = /import\s*\(\s*['"]([@\w/.-]+)['"]\s*\)/g;
    while ((match = dynamicRegex.exec(code)) !== null) {
        modules.add(match[1]);
    }

    return modules;
}

/**
 * Filter modules to get only those that should be resolved at runtime
 * (exclude node internals like 'path', 'fs', 'http', etc.)
 */
export function filterRuntimeModules(modules: Set<string>): Set<string> {
    const nodeInternals = new Set([
        'fs', 'path', 'http', 'https', 'stream', 'events', 'util', 'buffer',
        'crypto', 'os', 'child_process', 'net', 'tls', 'dgram', 'dns',
        'zlib', 'querystring', 'url', 'assert', 'cluster', 'module',
        'perf_hooks', 'v8', 'vm', 'worker_threads', 'async_hooks',
    ]);

    const filtered = new Set<string>();
    for (const mod of modules) {
        if (!nodeInternals.has(mod)) {
            filtered.add(mod);
        }
    }
    return filtered;
}

/**
 * Get the set of runtime modules from code
 */
export function getRuntimeModules(code: string): Set<string> {
    const allModules = extractImportedModules(code);
    return filterRuntimeModules(allModules);
}
