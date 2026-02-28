// Re-export remotion-md-runtime
export { render } from "remotion-md-runtime";
export type { RenderComponent, RenderOptions } from "remotion-md-runtime";

// Export shared types and utilities
export type { IframeCommand, PreviewMessage, PlayerStatus } from "./shared/types";
export type { Band, InterpolatorSpec, NullArray, Viewport, Interpolator } from "./shared/scroll-math";
export {
    findInterpolatorRegion,
    interpolatorFor,
    buildInterpolators,
    slipPreviews,
    hashBands,
} from "./shared/scroll-math";

import React from "react";
import ReactDomClient from "react-dom/client";
import ReactDom from "react-dom";

/**
 * Runtime helpers for React rendering
 *
 * These modules are imported statically here so the bundler can discover them.
 * They're exported to enable runtime access via window.require()
 */

export function createReactRoot(container: HTMLElement): any {
    if (ReactDomClient.createRoot) {
        return ReactDomClient.createRoot(container);
    }
    // Fallback for React 17 and earlier
    return (ReactDom as any).render;
}

export function getReact(): typeof React {
    return React;
}

export function getReactDom(): typeof ReactDom {
    return ReactDom;
}

// Re-export the modules themselves for direct access
export { React, ReactDomClient, ReactDom };
