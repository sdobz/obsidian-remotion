# Messaging Lifecycle

This document describes the flow of messages between the Preview plugin (main thread) and the Iframe runtime.

## Overview

Messages flow through two channels:

- **Preview → Iframe**: Lifecycle events and position/scroll updates
- **Iframe → Preview**: Player status and errors

All messages are handled via `window.postMessage()` with `"*"` target (no origin restriction needed in sandboxed iframe).

## Message Flow

### 1. Editor Loads

When the editor first opens or the preview is activated:

- **Message: `reflow`** → Iframe sends initial viewport dimensions and preview bands
  - `editorHeight`: Height of editor content
  - `bandScrollHeight`: Total iframe viewport height
  - `bands`: Array of pixel band positions (where preview() calls appear)

### 2. Types Check / Code Updates

When the TypeScript code is typechecked:

- **Message: `reflow`** → Send updated viewport dimensions and bands
  - Same as editor load, but may have different band positions if code changed

### 3. Bundle Finishes

When bundling completes and bundle code is ready:

- **Message: `bundle`** → Send player component code to iframe
  - `payload`: Bundled JavaScript code containing player components
  - `previewLocations`: Array of metadata about preview() calls
  - Iframe receives this, evals the code, and renders React players

### 4. Players Render

After React players mount in the iframe:

- **Message: `player-status`** ← Iframe sends back player dimensions
  - `players`: Array of player elements with their actual rendered heights
  - Preview receives this and calculates collision-resolved positioning

### 5. Calculate Collision Resolution & Scroll

After knowing player heights, scrolling is calculated:

- **Message: `scroll`** → Send scroll position and resolved player positions
  - `scrollTop`: Editor scroll position
  - `positions`: Array of final player positions after collision resolution
  - Iframe positions all players according to this data

### 6. User Scrolls Editor

When user manually scrolls the editor:

- **Trigger: `scroll` event listener** on editor
- **Message: `scroll`** → Send new scroll position and updated player positions
  - Same as step 5, recalculated for new scroll position

### 7. User Resizes Editor

When editor window is resized:

- **Trigger: `ResizeObserver`** on editor container
- **Message: `reflow`** → Send new viewport dimensions and recalculated bands
- **Message: `scroll`** → Send new scroll position and player positions
  - Both messages sent in sequence to update layout and positions

## Message Types

### IframeCommand (Preview → Iframe)

```typescript
type IframeCommand =
  | {
      type: "reset";
    }
  | {
      type: "reflow";
      editorHeight: number;
      bandScrollHeight: number;
      bands: Array<{ topOffset: number; height: number }>;
    }
  | {
      type: "bundle";
      payload: string;
      previewLocations: Array<Record<string, unknown>>;
    }
  | {
      type: "scroll";
      scrollTop: number;
      positions: Array<{ index: number; actualOffset: number; height: number }>;
    };
```

### PreviewMessage (Iframe → Preview)

```typescript
type PreviewMessage =
  | {
      type: "runtime-error";
      error?: { message?: string; stack?: string };
    }
  | {
      type: "player-status";
      players: Array<{ index: number; height: number; error?: string }>;
    }
  | {
      type: "iframe-ready";
    };
```

## Key Design Principles

1. **Single Responsibility**: Only the iframe manipulates iframe DOM. Preview sends commands, iframe executes them.

2. **Message-Based Updates**: All state changes flow through explicit messages, never direct DOM access.

3. **No Bidirectional Callbacks**: Preview doesn't hold references to iframe functions; all communication is async messaging.

4. **Lazy Initialization**: ScrollManager is created lazily when first needed, after iframe is loaded.

5. **Collision Resolution**: Preview calculates final player positions accounting for overlaps before sending them to iframe.

## Debug Tips

Enable console logging to trace message flow:

- Preview logs: `[Preview] ...` prefix
- ScrollManager logs: `[ScrollSync]` prefix
- Iframe logs: `[iframe] ...` prefix
