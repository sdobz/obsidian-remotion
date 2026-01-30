/**
 * Mark a JSX expression as a "preview" — a renderable scene in the preview.
 *
 * Use this to wrap bare JSX blocks in Markdown so they are recognized as
 * individual scenes, each with its own player in the preview.
 *
 * @example
 * ```tsx
 * preview(
 *   <div style={{ padding: 20, backgroundColor: 'blue' }}>
 *     Scene 1
 *   </div>
 * )
 * ```
 *
 * @param component The JSX component/element to render as a scene.
 * @returns The component (identity function).
 */
export function preview<T>(component: T): T {
    return component;
}

export type PreviewExpression = ReturnType<typeof preview>;
