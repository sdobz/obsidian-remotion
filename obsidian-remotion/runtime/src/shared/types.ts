/**
 * Shared types between plugin and iframe runtime
 */

import type { Band, InterpolatorSpec, NullArray } from "./scroll-math";

export interface WidgetStatus {
    height: number;
    error?: string;
}

/** @deprecated Use WidgetStatus */
export type PlayerStatus = WidgetStatus;

/** Message received from iframe */
export type PreviewMessage =
    | {
        type: "runtime-error";
        error?: { message?: string; stack?: string };
    }
    | {
        type: "widget-status";
        widgets: WidgetStatus[];
    }
    | {
        type: "widget-scroll";
        widgetScrollTop: number;
    }
    | {
        type: "runtime-ready";
    };

/** Message sent to iframe */
export type IframeCommand =
    | {
        type: "reset";
    }
    | {
        type: "show-error";
        message: string;
        stack?: string;
    }
    | {
        type: "clear-error";
    }
    | {
        type: "reflow";
        bandScrollHeight: number;
        bands: NullArray<Band>;
        widgetScrollHeight: number;
        widgets: NullArray<Band>;
        interpolatorSpecs: InterpolatorSpec[];
    }
    | {
        type: "bundle";
        payload: string;
    }
    | {
        type: "scroll";
        editorScrollTop: number;
    };
