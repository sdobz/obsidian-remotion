/**
 * Bundle execution module
 * Handles loading, evaluating, and managing the module system for user code bundles
 */

type Scene = {
  id: string;
  component: unknown;
  options?: Record<string, unknown>;
};

export type Sequence = {
  scenes: Scene[];
};

export class BundleManager {
  private currentSequence: Sequence | null = null;

  constructor() {
    // Ensure require exists for the user bundle
    if (typeof (window as any).require !== "function") {
      (window as any).require = (id: string) => {
        throw new Error(
          `Module not found: ${id}. All modules must be pre-injected.`,
        );
      };
    }
  }

  /**
   * Load and evaluate a bundle, extracting the sequence
   * Returns the sequence on success, null on error
   */
  loadBundle(
    code: string,
    onError: (message: string, stack: string) => void,
  ): Sequence | null {
    try {
      (window as any).RemotionBundle = undefined;
      // eslint-disable-next-line no-eval
      eval(code);
      const mod = (window as any).RemotionBundle;
      let sequence = (mod && mod.default) || mod;

      // If no explicit default export, build scenes from render() calls
      if (!sequence || !sequence.scenes) {
        const previewComponents = (globalThis as any).__previewComponents || [];
        const previewOptions = (globalThis as any).__previewOptions || [];

        if (previewComponents.length > 0) {
          const scenes = previewComponents.map(
            (component: unknown, i: number) => ({
              id: "__scene_" + i,
              component: component,
              options: previewOptions[i] || {},
            }),
          );
          sequence = { scenes };
        } else {
          // No renders - return null to indicate empty state
          this.currentSequence = null;
          return null;
        }
      }

      // Store sequence
      this.currentSequence = sequence;
      return sequence;
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

  reset(): void {
    this.currentSequence = null;
  }
}
