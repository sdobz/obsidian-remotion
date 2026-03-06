export type Scene = {
  id: string;
  component: unknown;
  options?: Record<string, unknown>;
};

export type Sequence = {
  scenes: Scene[];
};

export class BundleManager {
  private currentSequence: Sequence | null = null;

  constructor() { }

  /**
   * Load and evaluate a bundle and resolve scenes from render() registrations.
   */
  loadBundle(
    code: string,
    onError: (message: string, stack: string) => void,
  ): Sequence | null {
    try {
      const anyWindow = window as unknown as {
        RuntimeBundle?: unknown;
        __previewComponents?: unknown[];
        __previewOptions?: Record<string, unknown>[];
        __runtimeDebug?: Record<string, unknown>;
      };

      (window as any).RuntimeBundle = undefined;
      anyWindow.__previewComponents = [];
      anyWindow.__previewOptions = [];

      // eslint-disable-next-line no-eval
      eval(code);

      const previewComponents = anyWindow.__previewComponents ?? [];
      const previewOptions = anyWindow.__previewOptions ?? [];
      const scenes = previewComponents.map((component: unknown, index: number) => ({
        id: `__scene_${index}`,
        component,
        options: previewOptions[index] ?? {},
      }));

      anyWindow.__runtimeDebug = {
        bundleKeys: Object.keys(((anyWindow.RuntimeBundle as Record<string, unknown>) ?? {})),
        previewComponentCount: previewComponents.length,
      };

      if (scenes.length === 0) {
        this.currentSequence = null;
        return null;
      }

      this.currentSequence = { scenes };
      return this.currentSequence;
    } catch (err) {
      const message =
        err && (err as any).message ? (err as any).message : String(err);
      const stack = err && (err as any).stack ? (err as any).stack : "";
      onError(message, stack);
      return null;
    }
  }

  get sequence(): Sequence | null {
    return this.currentSequence;
  }

  setSequence(scenes: Scene[]): void {
    this.currentSequence = scenes.length > 0 ? { scenes } : null;
  }

  reset(): void {
    this.currentSequence = null;
  }
}
