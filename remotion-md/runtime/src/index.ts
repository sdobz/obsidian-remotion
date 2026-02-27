export type RenderOptions = Record<string, unknown>;
export type RenderComponent = (...args: unknown[]) => unknown;

export function render<T extends RenderComponent>(
  component: T,
  options?: RenderOptions,
): T {
  const anyGlobal = globalThis as any;
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
