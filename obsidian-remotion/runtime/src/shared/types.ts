/**
 * Shared types between plugin and iframe runtime
 */

import type { Band, InterpolatorSpec, NullArray } from "./scroll-math";

export interface PlayerStatus {
    height: number;
    error?: string;
}

/** Message received from iframe */
export type PreviewMessage =
    | {
        type: "runtime-error";
        error?: { message?: string; stack?: string };
    }
    | {
        type: "player-status";
        players: PlayerStatus[];
    }
    | {
        type: "player-scroll";
        playerScrollTop: number;
    }
    | {
        type: "iframe-ready";
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
        playerScrollHeight: number;
        players: NullArray<Band>;
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
