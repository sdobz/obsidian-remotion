export type RuntimeDeps = Record<string, unknown>;

type RuntimeWindow = {
    require?: (id: string) => unknown;
};

export function installRuntimeDeps(
    iframeWindow: RuntimeWindow,
    deps: RuntimeDeps,
): void {
    iframeWindow.require = (id: string) => {
        if (Object.prototype.hasOwnProperty.call(deps, id)) {
            return deps[id];
        }
        throw new Error(`Module not found: ${id}. All modules must be pre-injected.`);
    };
}
