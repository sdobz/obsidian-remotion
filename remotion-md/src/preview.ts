/**
 * Player configuration options compatible with Remotion's Player component.
 * All fields are optional and use sane defaults when not specified.
 */
export interface PreviewPlayerOptions {
    durationInFrames?: number;
    fps?: number;
    compositionWidth?: number;
    compositionHeight?: number;
    controls?: boolean;
    loop?: boolean;
    autoPlay?: boolean;
    [key: string]: any;
}

/**
 * Default player options used when not specified.
 * These match typical Remotion defaults.
 */
export const PREVIEW_DEFAULTS: PreviewPlayerOptions = {
    durationInFrames: 150,
    fps: 30,
    compositionWidth: 1280,
    compositionHeight: 720,
    controls: true,
    loop: false,
    autoPlay: false,
};

/**
 * Render a component in the preview pane.
 * Simple pass-through that lets you preview during development.
 *
 * @example
 * ```tsx
 * export const Title = () => <h1>My Title</h1>;
 *
 * // Preview with defaults
 * preview(Title)
 *
 * // Preview with custom options
 * preview(Title, { durationInFrames: 120, fps: 60 })
 *
 * export default (
 *   <Composition
 *     component={Title}
 *     durationInFrames={120}
 *     fps={30}
 *   />
 * )
 * ```
 *
 * @param component The component to preview
 * @param options Player configuration options (optional)
 * @returns The component unchanged
 */
export function preview<T>(component: T, options?: PreviewPlayerOptions): T {
    // Track component for scenes structure
    if (typeof globalThis !== 'undefined') {
        if (!(globalThis as any).__previewComponents) {
            (globalThis as any).__previewComponents = [];
        }
        if (!(globalThis as any).__previewOptions) {
            (globalThis as any).__previewOptions = [];
        }
        
        const index = (globalThis as any).__previewComponents.length;
        (globalThis as any).__previewComponents[index] = component;
        (globalThis as any).__previewOptions[index] = { ...PREVIEW_DEFAULTS, ...options };
    }
    return component;
}

export type PreviewExpression = ReturnType<typeof preview>;

