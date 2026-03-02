export type RenderOptions = Record<string, unknown>;
export type RenderComponent = (...args: unknown[]) => unknown;

export function render<T extends RenderComponent>(
    component: T,
    options?: RenderOptions,
): T {
    const anyGlobal =
        (typeof window !== "undefined" ? window : globalThis) as unknown as {
            __previewComponents?: unknown[];
            __previewOptions?: RenderOptions[];
        };

    if (!anyGlobal.__previewComponents) {
        anyGlobal.__previewComponents = [];
    }

    if (!anyGlobal.__previewOptions) {
        anyGlobal.__previewOptions = [];
    }

    const index = anyGlobal.__previewComponents.length;
    anyGlobal.__previewComponents[index] = component;
    anyGlobal.__previewOptions[index] = options ?? {};
    return component;
}
