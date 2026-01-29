# Obsidian Remotion Preview Plugin — Implementation README

## Goal

Build an Obsidian plugin that turns Markdown notes into **live, type-checked Remotion previews** rendered in a right-side panel. The system treats Markdown as the *host language* and TypeScript/TSX as embedded, controlled content. The output is one or more Remotion players that stay in sync with the editor.

This is not “Remotion inside Obsidian” — it is a **document-to-timeline compiler** with Remotion as the rendering backend.

---

## Core Concepts

### 1. Notes as Sequences
- A `.md` file defines a **sequence** (a timeline).
- The default semantic export of a note is its sequence.
- Importing a Markdown file means importing its sequence, not a function or component.

Conceptually:
- `.md` → Sequence
- `.tsx` → Library / helpers
- Bare JSX → Scene declarations

---

### 2. TypeScript Blocks Are Literate Code
- All TypeScript / TSX fenced blocks in a note are read.
- They are concatenated into a **single virtual TSX module**.
- Imports can appear anywhere and behave like normal TypeScript imports.
- Sentinel comments preserve source mapping back to the Markdown file.

The user experiences this as:
> “My note behaves like one TSX file, but with prose.”
**Implementation:**
- Extract fenced code blocks with language `ts`, `tsx`, or `typescript`.
- Use Obsidian's Markdown parser (not regex) for stability.
- Preserve block order and character offsets for diagnostic mapping.
- Insert sentinel comments between blocks: `// --- block N @ NoteName.md:LINE ---`
---

### 3. Bare JSX at Top Level Creates Scenes
- A top-level JSX expression (e.g. `<Scene />`) is **not a syntax error**.
- It is interpreted as a **scene declaration**.
- Each such JSX block creates a Remotion player.

Implementation strategy:
- Classify TS blocks into:
  - Module blocks (imports, declarations)
  - JSX entry blocks (bare JSX)
- JSX entry blocks are wrapped into generated exports so TypeScript remains valid.

One note can define multiple scenes.

**Block Classification:**
- Trim whitespace from block content.
- If block starts with `<`, doesn't end with `/>` or `>`, and lacks keywords (`export`, `const`, `function`, `class`, `import`) → JSX entry block.
- JSX entry blocks are wrapped: `export const __scene_N = () => ( <original JSX> );`
- Module blocks are concatenated normally before scene exports.

---

### 4. Virtual Filesystem & Compiler API
- Use the TypeScript Compiler API with a **virtual filesystem**.
- No real disk IO for generated files.
- Virtual paths like:
  - `/virtual/folder/Foo.md.tsx` (vault-relative mapping of `folder/Foo.md`)
- Relative imports work intuitively:
  - Importing `./Bar` resolves to `Bar.tsx` or `Bar.md` (synthesized).

This enables:
- Full type checking
- Real diagnostics
- Controlled import surface

**Implementation:**
- Use a custom `CompilerHost` backed by `Map<string, string>`.
- Path convention: `folder/Foo.md` → `/virtual/folder/Foo.md.tsx`.
- Resolution order: try real `.ts`/`.tsx` files first, then synthesize from `.md`.
- Include type definitions in virtual FS: `/react.d.ts`, `/remotion.d.ts`.
- Use `ts.createProgram()` with incremental mode for caching.

---

### 5. Markdown Imports Are Semantic
- Default-importing a Markdown file yields its **sequence**.
- Named imports from Markdown are not supported.
- TypeScript sees a shim declaration for `.md` imports.
- Runtime rewrites replace `.md` imports with injected sequence objects.

Sequences are ordered and composable; they are not callable or queryable.

**Sequence Structure:**
```typescript
type Sequence = {
  id: string;
  scenes: Scene[];
  durationInFrames: number;
};
```

**Type Shim for `.md` imports:**
```typescript
// /virtual/notes/Foo.md.ts
declare const sequence: Sequence;
export default sequence;
```

---

## Remotion Runtime Model

### Controlled Iframe
- Remotion runs inside a sandboxed iframe.
- The iframe receives:
  - Bundled JS (string)
  - Explicitly injected dependencies (React, Remotion)
  - Sequence and scene metadata
- No filesystem, no implicit imports.

The iframe is disposable and reload-safe.

**Communication Protocol:**

Parent → Iframe:
```typescript
{ type: "load-scene", code: string, metadata: SceneMetadata }
{ type: "focus-scene", sceneId: string }
{ type: "highlight-scene", sceneId: string }
```

Iframe → Parent:
```typescript
{ type: "runtime-error", sceneId: string, error: Error }
{ type: "scene-activated", sceneId: string }
```

**Node Module Usage (no allowlist):**
- Imports should resolve via standard Node resolution using `node_modules` located in the ancestor tree of the active note.
- Avoid custom import rewriting or bundling at this stage; rely on existing tooling/runtime for resolution.
- Use package installs (e.g. `npm install <pkg>`) and keep packages browser-compatible (avoid native/binary addons).

---

### Player Generation
- Each scene maps to one Remotion player.
- Multiple players are stacked vertically in the iframe.
- Scene metadata includes:
  - Origin note
  - Block index
  - Source range

---

## Obsidian UI Integration

### Right-Side Panel
- Implemented as a custom Obsidian View.
- Opened in a right-side workspace leaf.
- Contains a single iframe that manages all players.

The panel:
- Does not steal focus
- Persists across file changes
- Hot-reloads content via postMessage

**Implementation:**
```typescript
const REMOTION_VIEW_TYPE = "remotion-preview";

class RemotionPreviewView extends ItemView {
  iframe: HTMLIFrameElement;
  
  getViewType() { return REMOTION_VIEW_TYPE; }
  getDisplayText() { return "Remotion Preview"; }
  
  async onOpen() {
    this.iframe = this.containerEl.createEl("iframe");
    this.iframe.srcdoc = iframeHtml;
    // Setup postMessage listeners
  }
}
```

Open with: `app.workspace.getLeaf("split", "vertical")` and `active: false`.

---

## Scroll & Focus Synchronization

### Semantic Sync (Not Pixel Sync)
- Sync is based on **scene identity**, not scroll position.
- Editor → Player:
  - Cursor movement determines active block.
  - Corresponding player is highlighted or scrolled into view.
- Player → Editor:
  - Clicking or activating a player scrolls to the source block.

Directional locking prevents feedback loops.

**Implementation:**

1. **Cursor → Block Mapping:**
   - On cursor activity: `editor.posToOffset(editor.getCursor())`
   - Binary search through extracted block ranges
   - Find containing JSX entry block or nearest one

2. **Feedback Prevention:**
   ```typescript
   let syncingFromEditor = false;
   let syncingFromPlayer = false;
   // Use 50-100ms timeout to clear flags
   ```

3. **Focus vs Highlight:**
   - `focus-scene`: scrolls player into view
   - `highlight-scene`: visual indication only (calmer UX)
   - Cursor movement → highlight, explicit jump → focus

4. **Editor Scrolling:**
   ```typescript
   const { from, to } = scene.mdRange;
   editor.setCursor(editor.offsetToPos(from));
   editor.scrollIntoView({ from, to }, true);
   ```

---

## Error Handling

### Compile-Time
- TypeScript diagnostics mapped back to Markdown code blocks.
- Inline editor highlights and panel-level error badges.

**Implementation:**
- Use `ts.getPreEmitDiagnostics(program)` for type errors.
- Map diagnostics using sentinel comment positions:
  - `/virtual/notes/Scene.tsx:42` → `Scene.md line 17, block #2`
- Display as:
  - Gutter markers in editor
  - Error badges on player headers: `✅`, `⚠️ 3`, `❌ 2`
  - Hover tooltips with full error text

### Runtime
- Iframe catches runtime errors.
- Errors are reported back to the plugin.
- Plugin focuses both:
  - The failing player
  - The originating Markdown block

**Implementation:**
```typescript
// Inside iframe
try {
  eval(sceneBundle);
} catch (err) {
  window.parent.postMessage({
    type: 'runtime-error',
    sceneId: '__scene_N',
    error: { message: err.message, stack: err.stack }
  }, '*');
}
```

**Error Display:**
- Overlay in player matching Remotion's dev server style
- Simultaneous focus on source block and player
- Preserve error state across hot reloads until fixed

---

## Key Design Principles

- Markdown is the host language.
- TypeScript is a guest.
- JSX can be data, not just code.
- Imports are explicit and intentional.
- Scroll sync is semantic, not positional.
- Remotion is a rendering backend, not the project owner.

---

## Expected Outcome

The user experiences:
- Writing prose and code together
- Dropping JSX directly into notes to create scenes
- Seeing live, type-checked previews on the right
- Seamless navigation between text and timeline

The system behaves like a **literate, timeline-oriented IDE embedded in Obsidian**.

---

## Implementation Notes for Agents

- Do not relax TypeScript grammar globally; transform inputs instead.
- Avoid pixel-based scroll syncing.
- Avoid exposing the vault filesystem to the iframe.
- Prefer incremental compiler programs and caching.
- Treat `.md` imports as semantic, not lexical.

This README defines the contract. Implementation details are flexible as long as these semantics hold.
