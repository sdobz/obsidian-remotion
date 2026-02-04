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
  private __modules__: Record<string, unknown> = {};
  private pendingModuleRequests: Map<string, Promise<unknown>> = new Map();

  constructor() {
    // Expose require globally so esbuild's bundle can use it
    (window as any).require = this.require.bind(this);
    (window as any).__REMOTION_DEPS__ = (window as any).__REMOTION_DEPS__ || {};

    // Listen for module responses from parent
    window.addEventListener("message", (event) => {
      if (event.data?.type === "module-response") {
        const { id, module } = event.data;
        (window as any).__REMOTION_DEPS__[id] = module;
        // Wake up any pending require calls
        if (this.pendingModuleRequests.has(id)) {
          this.pendingModuleRequests.delete(id);
        }
      }
    });
  }

  // Minimal require polyfill - checks __modules__ and window globals
  private require(id: string): unknown {
    if (this.__modules__[id]) return this.__modules__[id];
    if ((window as any)[id]) return (window as any)[id];
    if (
      (window as any).__REMOTION_DEPS__ &&
      (window as any).__REMOTION_DEPS__[id]
    )
      return (window as any).__REMOTION_DEPS__[id];

    // Module not found - request from parent
    if (!this.pendingModuleRequests.has(id)) {
      window.parent.postMessage({ type: "request-module", id }, "*");

      // Wait for module to be loaded (with timeout)
      const startTime = Date.now();
      const maxWait = 5000;
      while (Date.now() - startTime < maxWait) {
        if (
          (window as any).__REMOTION_DEPS__ &&
          (window as any).__REMOTION_DEPS__[id]
        ) {
          return (window as any).__REMOTION_DEPS__[id];
        }
        // Busy wait is not ideal but necessary for sync require
      }
    }

    if (
      (window as any).__REMOTION_DEPS__ &&
      (window as any).__REMOTION_DEPS__[id]
    )
      return (window as any).__REMOTION_DEPS__[id];

    throw new Error("Module not found: " + id);
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

      // If no explicit default export, build scenes from preview() calls
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
          // No previews - return null to indicate empty state
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
