/**
 * Register a shot (component) to be previewed individually and included in the scene.
 *
 * @example
 * ```tsx
 * import { preview, scene } from 'remotion-md';
 * 
 * preview(<Title>Shot 1</Title>, 150)
 * preview(<Title>Shot 2</Title>, 90)
 * 
 * scene()  // Shows shots with their specified durations
 * ```
 *
 * @param component The JSX component/element to render as a shot.
 * @param durationInFrames Duration of this shot in frames (default: 150)
 * @returns A function component that renders the provided JSX.
 */
export function preview<T>(component: T, durationInFrames: number = 150): () => T {
    const fn = () => component;
    // Push to global tracking array (created by synthesis)
    if (typeof globalThis !== 'undefined' && (globalThis as any).__previewScenes) {
        (globalThis as any).__previewScenes.push(fn);
    }
    // Track shots with their durations for scene composition
    if (typeof globalThis !== 'undefined' && (globalThis as any).__previewShots) {
        (globalThis as any).__previewShots.push({ component: fn, duration: durationInFrames });
    }
    return fn;
}

/**
 * Create a composition showing all previously registered shots in sequence.
 * Uses Remotion's Sequence to concatenate all shots with their specified durations.
 *
 * @example
 * ```tsx
 * import { preview, scene } from 'remotion-md';
 * 
 * preview(<Title>Shot 1</Title>, 150)  // 5 seconds
 * preview(<Title>Shot 2</Title>, 90)   // 3 seconds
 * 
 * scene()  // Shows Shot 1 (5s) followed by Shot 2 (3s) = 8s total
 * ```
 *
 * @returns A function component that renders all shots in sequence with auto-scaled durations.
 */
export function scene(): () => any {
    const fn = () => {
        // Get all shots registered up to this point
        const shots = typeof globalThis !== 'undefined' && (globalThis as any).__previewShots 
            ? [...(globalThis as any).__previewShots]
            : [];
        
        // Import React and Remotion at runtime
        const React = (globalThis as any).__REMOTION_DEPS__?.react;
        const remotion = (globalThis as any).__REMOTION_DEPS__?.remotion;
        
        if (!React || !remotion) {
            return React?.createElement('div', {}, 'Missing dependencies');
        }
        
        const { Sequence } = remotion;
        
        // Calculate cumulative frame positions
        let currentFrame = 0;
        const sequences = shots.map((shot: any, idx: number) => {
            const Component = shot.component;
            const duration = shot.duration || 150;
            const from = currentFrame;
            currentFrame += duration;
            
            return React.createElement(
                Sequence,
                { 
                    key: idx,
                    from: from,
                    durationInFrames: duration
                },
                React.createElement(Component)
            );
        });
        
        return React.createElement(React.Fragment, null, ...sequences);
    };
    
    // Push scene to tracking array
    if (typeof globalThis !== 'undefined' && (globalThis as any).__previewScenes) {
        (globalThis as any).__previewScenes.push(fn);
    }
    
    // Reset shots for next scene
    if (typeof globalThis !== 'undefined' && (globalThis as any).__previewShots) {
        (globalThis as any).__previewShots = [];
    }
    
    return fn;
}

// Type declaration for global tracking arrays
declare global {
    var __previewScenes: Array<() => any>;
    var __previewShots: Array<() => any>;
}

export type PreviewExpression = ReturnType<typeof preview>;
export type SceneExpression = ReturnType<typeof scene>;

