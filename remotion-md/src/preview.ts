/**
 * Mark a JSX expression as a "preview" — a renderable scene in the preview.
 *
 * Use this to wrap bare JSX blocks in Markdown so they are recognized as
 * individual scenes, each with its own player in the preview.
 *
 * This function tracks components globally so synthesis doesn't need to rewrite code.
 *
 * @example
 * ```tsx
 * import { preview } from 'remotion-md';
 * 
 * preview(
 *   <div style={{ padding: 20, backgroundColor: 'blue' }}>
 *     Scene 1
 *   </div>
 * )
 * ```
 *
 * @param component The JSX component/element to render as a scene.
 * @returns A function component that renders the provided JSX.
 */
export function preview<T>(component: T): () => T {
    const fn = () => component;
    // Push to global tracking array (created by synthesis)
    if (typeof globalThis !== 'undefined' && (globalThis as any).__previewScenes) {
        (globalThis as any).__previewScenes.push(fn);
    }
    return fn;
}

// Type declaration for global tracking array
declare global {
    var __previewScenes: Array<() => any>;
}

export type PreviewExpression = ReturnType<typeof preview>;
