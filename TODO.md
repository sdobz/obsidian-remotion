# Obsidian Remotion Implementation Plan

## Core Semantic Layer: Extraction & Synthesis

### Block Extraction
- [x] **Extract TSX blocks from markdown**
  - Semantics: Parse a `.md` file and extract all fenced code blocks with language `ts`, `tsx`, `typescript`
  - Output: List of blocks with `{ content, language, startLine, endLine, startOffset, endOffset }`
  - Architecture checkpoint: Should work with Obsidian's built-in parser; no regex
  - Test case: `Basic.md` should extract 2–3 blocks

### Block Classification  
- [ ] **Classify extracted blocks into module vs JSX entry**
  - Semantics: Determine if a block is "module code" (imports, declarations) or "JSX entry code" (bare JSX to render)
  - Decision logic: Trim block, check if starts with `<`, lacks keywords, ends with `>` or `/>` → JSX entry
  - Output: List of blocks tagged as `{ ..., type: 'module' | 'jsx-entry', blockIndex }`
  - Architecture checkpoint: Classification is deterministic and reversible; no ambiguity
  - Test case: Mix module and JSX blocks; verify correct labels

### Virtual Module Synthesis
- [ ] **Concatenate blocks into a single virtual TSX source**
  - Semantics: Merge all blocks into one cohesive TSX module, preserving source position data
  - Transformation: Insert sentinel comments `// --- block N @ File.md:LINE ---` between blocks
  - Output: Single string representing `/virtual/notes/File.tsx`
  - Architecture checkpoint: Sentinels are stable and map back to markdown line numbers
  - Test case: Synthesized module should have all imports + helpers + wrapped JSX entries

---

## Core Compiler: TypeScript & Virtual Filesystem

### Virtual Filesystem Host
- [ ] **Implement custom TypeScript CompilerHost backed by in-memory map**
  - Semantics: Create a module resolution system where the only "files" are what you explicitly provide
  - Implementation: `createCompilerHost(files: Map<string, string>) → ts.CompilerHost`
  - Inputs: Vault files (real `.ts`/`.tsx`), synthesized modules (`.md` → `.tsx`), type shims
  - Architecture checkpoint: No disk I/O; all paths are virtual and deterministic
  - Test case: Compiler can resolve `./Foo` from `Foo.md` (synthesized)

### Type Shim Generation for Markdown Imports
- [ ] **Generate TypeScript declaration files for `.md` imports**
  - Semantics: Create fake `.d.ts` files so TS sees `import X from "Foo.md"` as valid
  - Output: For each `Foo.md`, generate `/virtual/notes/Foo.md.ts` with `declare const sequence: Sequence; export default sequence;`
  - Architecture checkpoint: Real `.md` imports become type-safe; no JSX/function confusion
  - Test case: Importing a `.md` file should type-check without errors

### Compile to JavaScript
- [ ] **Use TypeScript Compiler API to emit JSX entry code as JavaScript**
  - Semantics: Transform synthesized TSX → valid JS, collect type errors
  - Implementation: `ts.createProgram()` + `program.emit()` with options `jsx: React, target: ES2020`
  - Output: `{ code: string, diagnostics: ts.Diagnostic[] }`
  - Architecture checkpoint: Errors are mapped back to markdown line numbers via sentinels
  - Test case: No type errors in valid TSX; clear errors in invalid code

### Import Rewriting to Globals
- [ ] **Rewrite module imports to reference injected globals**
  - Semantics: Transform `import { X } from 'module'` → `const { X } = window.__REMOTION_DEPS__.module`
  - Allowed modules: `react`, `remotion`, and any explicitly whitelisted
  - Implementation: AST transform or careful string rewriting
  - Architecture checkpoint: Imports outside allowlist cause compile-time errors
  - Test case: `import { spring } from 'remotion'` becomes global reference; unknown imports fail

### Wrap JSX Entries into Exports
- [ ] **Transform bare JSX blocks into valid exported functions**
  - Semantics: Convert `<Scene />` (illegal at top level) → `export const __scene_N = () => ( <Scene /> );`
  - Triggering condition: Block is classified as `jsx-entry`
  - Output: Valid TS that can be type-checked and emitted
  - Architecture checkpoint: Original JSX is preserved inside the export; no transformation of content
  - Test case: A `.md` with bare `<Scene />` becomes a named export

---

## Iframe Runtime & Registration

### Iframe Initialization
- [ ] **Set up sandboxed iframe with injected dependencies**
  - Semantics: Create an HTML iframe that has no filesystem, only explicit globals
  - Content: Inject React, Remotion, and a runtime message listener
  - Output: `iframe.srcdoc` with `window.__REMOTION_DEPS__ = { react, remotion, ... }`
  - Architecture checkpoint: Iframe is disposable and reload-safe; can be recreated at any time
  - Test case: Iframe loads and posts `ready` message back to parent

### Scene Registration
- [ ] **Dynamically register Remotion compositions from emitted code**
  - Semantics: Execute the emitted JS in the iframe; extract `__scene_N` exports and register as Remotion compositions
  - Implementation: `eval()` the bundled code, then call `Remotion.registerComposition()` for each scene
  - Metadata: Scene ID, display name (from block index or nearby heading), duration, config
  - Architecture checkpoint: Each scene is independently registered; order is deterministic
  - Test case: A `.md` with two JSX blocks results in two registered compositions

### Error Boundary in Iframe
- [ ] **Catch runtime errors in the iframe and report back to plugin**
  - Semantics: Wrap scene execution in try/catch; on error, post message with details
  - Output: `{ type: 'runtime-error', sceneId, message, stack }` posted to parent
  - Architecture checkpoint: Errors don't crash the iframe; it remains usable for hot reload
  - Test case: Invalid JSX or missing imports produce reportable errors

### Hot Reload Protocol
- [ ] **Update compositions without reloading the iframe**
  - Semantics: Parent sends new JS via postMessage; iframe clears old scenes and registers new ones
  - Message format: `{ type: 'load-scene', code: string, metadata: SceneMetadata[] }`
  - Preservation: Playback state, timeline position, zoom level should survive reload
  - Architecture checkpoint: Reload is incremental; only scenes with new code are updated
  - Test case: Editing a `.md` file updates the preview in <1s without flicker

---

## Editor Sync & Diagnostics

### Cursor-to-Block Mapping
- [ ] **Map editor cursor position to corresponding JSX entry block**
  - Semantics: Given cursor position, find which block the cursor is in; if not JSX entry, find nearest one
  - Implementation: Binary search through extracted block offset ranges
  - Output: `blockIndex` or `null` if no relevant block
  - Architecture checkpoint: Mapping is O(log n) and stable across edits
  - Test case: Cursor movement fires correct `focus-scene` messages

### Focus Sync: Editor → Preview
- [ ] **Scroll preview to show the scene under the cursor**
  - Semantics: When cursor moves in editor, highlight or scroll corresponding player in iframe
  - Message: `{ type: 'focus-scene', sceneId: '__scene_N' }`
  - UI: Player header is highlighted or scrolled into view
  - Architecture checkpoint: Sync is directional (no feedback loop); uses 50ms timeout
  - Test case: Moving cursor between blocks visibly changes highlighted player

### Focus Sync: Preview → Editor
- [ ] **Scroll editor to show the block when player is clicked**
  - Semantics: When player is activated (click, play, etc.), scroll editor to originating block
  - Message: `{ type: 'scene-activated', sceneId: '__scene_N' }` (from iframe to plugin)
  - Editor action: `editor.setCursor()` + `scrollIntoView()` to block range
  - Architecture checkpoint: Block range is preserved from synthesis phase
  - Test case: Clicking a player scrolls editor to its source block

### Diagnostic Display
- [ ] **Map TypeScript diagnostics back to markdown line numbers**
  - Semantics: When TS reports error at line 42 in `/virtual/notes/File.tsx`, find which markdown block and line that corresponds to
  - Implementation: Use sentinel comments to reverse-map
  - Output: `{ line, column, message, blockIndex }` in markdown space
  - Architecture checkpoint: All diagnostics have a markdown location; no "unknown" errors
  - Test case: Type error shows up in editor at exact line in code block

### Inline Error Display
- [ ] **Show compile and runtime errors in the editor and iframe**
  - Semantics: Display errors as gutter markers, hover tooltips, and error overlays
  - Locations: Editor gutter (inline), player header (badge with count), player body (overlay on error)
  - Architecture checkpoint: Errors persist until fixed; don't disappear on hot reload
  - Test case: Missing type shows red squiggle; player shows badge; hovering shows tooltip

---

## File Watching & Incremental Updates

### Watch Active File for Changes
- [ ] **Listen for edits in the active markdown file**
  - Semantics: When file content changes, re-extract blocks and re-synthesize
  - Implementation: Obsidian `workspace.on('file-change')` or editor CM change listener
  - Debouncing: Wait 300ms after last keystroke before recompiling
  - Output: Emits recompile event with new virtual module
  - Architecture checkpoint: Edits in non-active files are ignored (for MVP)
  - Test case: Adding a `<Scene />` block updates preview within 300ms

### Incremental Compilation
- [ ] **Cache compilation artifacts to avoid redundant work**
  - Semantics: Store previous virtual module, extracted blocks, and diagnostics; only recompile if content changed
  - Caching: By file path and content hash
  - Invalidation: Only invalidate affected scenes, not entire module
  - Architecture checkpoint: Second edit to same file is faster than first
  - Test case: Adding whitespace doesn't trigger recompile

---

## Integration & Bootstrapping

### Plugin Lifecycle
- [ ] **Implement onload() and onunload() hooks**
  - Semantics: Initialize compiler on plugin load; clean up iframe on unload
  - onload: Set up virtual FS, initialize first compilation, register view
  - onunload: Dispose iframe, clear caches, detach view
  - Architecture checkpoint: Plugin can be disabled and re-enabled cleanly
  - Test case: Disabling and re-enabling plugin doesn't break state

### Active File Tracking
- [ ] **Track which file is active and trigger compilation**
  - Semantics: When user opens/switches files, detect if it's a markdown file and start compilation
  - Implementation: `workspace.on('active-leaf-change')` + type check for MarkdownView
  - Output: Triggers extraction and compilation for new active file
  - Architecture checkpoint: Compilation only happens for active file (MVP optimization)
  - Test case: Opening a new `.md` file starts preview; switching away stops it

### Command Palette Entry
- [ ] **Add ribbon icon and command to open preview pane**
  - Semantics: User can click icon or run command to open the preview panel
  - Implementation: `addRibbonIcon()` and `addCommand()` that call `activateView()`
  - UI: Preview opens to the right side, doesn't steal focus
  - Architecture checkpoint: Can be opened/closed multiple times without errors
  - Test case: Clicking icon opens preview; clicking again reveals if hidden

---

## Validation & First Run

### MVP Test Scenario
- [ ] **E2E test: Create a basic scene in a markdown file and see it render**
  - Steps:
    1. Open or create `Basic.md`
    2. Add a TSX block with Remotion imports
    3. Add a bare `<Composition>` JSX block
    4. Open preview pane
    5. Verify scene appears and is interactive
  - Success criteria: No console errors; player renders; editing file updates preview
  - Architecture checkpoint: All layers work together end-to-end

### Documentation of Semantic Boundaries
- [ ] **Document the "semantic gradient" — how abstract ideas map to concrete code**
  - Examples:
    - `"preview"` → `PreviewView` class + iframe instance
    - `"scene"` → one JSX entry block → one `__scene_N` export → one Remotion composition
    - `"virtual module"` → synthesized string + virtual FS entry + in-memory TS Program
  - Purpose: Makes it clear to agents and humans where to intervene
  - Architecture checkpoint: New tasks can be added without confusion
