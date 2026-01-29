# Obsidian Remotion Preview Plugin — Implementation README

## Goal

Build an Obsidian plugin that turns Markdown notes into **live, type-checked Remotion previews** rendered in a right-side panel. The system treats Markdown as the *host language* and TypeScript/TSX as embedded, controlled content. The output is one or more Remotion players that stay in sync with the editor.

This is not "Remotion inside Obsidian" — it is a **document-to-timeline compiler** with Remotion as the rendering backend.

---

## Quick Start

### For Plugin Users

**Basic (Zero Setup):**
```bash
# 1. Install plugin in Obsidian
# 2. Create a note with TSX blocks:
```

````markdown
# My First Scene

```tsx
<div style={{ backgroundColor: 'red', width: 100, height: 100 }}>
  Hello Remotion!
</div>
```
````

```bash
# 3. Open "Remotion Preview" from command palette
# 4. See live preview powered by Remotion
```

**Note:** First time setup requires installing Remotion & React in your vault (see Setup section)

**Advanced (With Custom Packages):**
```bash
cd /path/to/vault
npm init -y
npm install @remotion/transitions
```

````markdown
# Scene With Transitions

```tsx
import { fade } from '@remotion/transitions/fade';

<div style={{ opacity: fade() }}>
  Fading in...
</div>
```
````

### For Developers

**Setup:**
```bash
git clone <repo>
cd obsidian-remotion
npm install
```

**Build:**
```bash
# Build the workspace
npm run build

# Or build individual packages:
npm run build -w remotion-md   # Build shared library
npm run build -w obsidian-remotion  # Build plugin (requires remotion-md built first)
```

**Develop:**
```bash
# Watch for changes to plugin
npm run watch -w obsidian-remotion

# Run tests
npm test

# Clean artifacts
npm run clean
```

**Install in Obsidian:**
```bash
# Symlink into Obsidian vault for development
ln -s $(pwd)/obsidian-remotion /path/to/vault/.obsidian/plugins/obsidian-remotion
```

---

## Dual-Use Workflow

This project supports **two distinct usage patterns**:

### 1. Plugin + Vault Environment
For users who want previews with full control over dependencies:

1. Install the `obsidian-remotion` plugin
2. Set up npm in your vault: `cd vault && npm init && npm install remotion react react-dom @remotion/player`
3. Create a `.md` file with TSX code blocks
4. Open the Remotion preview panel
5. **Preview renders using your vault's Remotion installation** — you control versions, updates, plugins

### 2. Advanced Vault Usage (Custom Remotion Packages)
For users who want additional Remotion extensions or version control:

1. Install the plugin
2. `cd` into your vault directory
3. Run `npm init` (or `npm init -y`)
4. Install Remotion core: `npm install remotion react react-dom @remotion/player`
5. Install additional packages: `npm install @remotion/transitions` (or any other package)
6. Import in your `.md` files: `import { fade } from '@remotion/transitions/fade';`
7. The plugin uses your vault's `node_modules` when bundling previews

The plugin itself is lightweight and does not bundle Remotion. Your vault's `node_modules` is the execution environment.

### 3. Standalone Remotion Projects (remotion-md as a library)
For users who want to **import Markdown files into vanilla Remotion projects**:

1. Create a standard Remotion project: `npm init remotion`
2. Install `remotion-md`: `npm install remotion-md`
3. Import `.md` files: `import scene from './scenes/MyScene.md';`
4. Use in compositions: `<Sequence {...scene}>`

**Note:** Markdown loader/plugin support (webpack/vite) is planned but not yet implemented. Currently, `remotion-md` provides the extraction/synthesis/compilation API.

### 4. CLI Rendering (Out-of-Band)
For users who want to render `.md` files **without Obsidian**:

1. Install globally: `npm install -g remotion-md` (or use `npx`)
2. Render: `remotion-md render MyScene.md output.mp4`

**Note:** CLI is planned but not yet implemented.

---

## Package Architecture

### `obsidian-remotion/` (The Plugin)
- **Purpose:** Obsidian plugin for live preview integration
- **Does NOT bundle:** React, Remotion, Player (kept lightweight)
- **Does bundle:** remotion-md, Rollup bundler, TypeScript Compiler
- **Resolves at runtime:** React, Remotion from vault's node_modules
- **External:** `obsidian` API (provided by Obsidian runtime)
- **Size:** ~500KB (lean plugin, no heavy dependencies)
- **Workflow:** Install plugin, set up npm environment in vault, preview loads from vault dependencies

### `remotion-md/` (Shared Core)
- **Purpose:** Standalone package for Markdown → Remotion compilation
- **Exports:** `extractCodeBlocks()`, `synthesizeVirtualModule()`, `compileVirtualModule()`
- **Dependencies:** TypeScript Compiler API only
- **Future:** Webpack/Vite loaders, CLI tool
- **Workflow:** Can be used independently of Obsidian

### `examples/` (Test Vault)
- **Purpose:** Development vault for testing
- **Dependencies:** React, Remotion (for intellisense)
- **Workflow:** Load as Obsidian vault, test plugin features

---

## Workspace Setup & Build Process

### NPM Workspaces

This is a **monorepo** using npm workspaces (`workspace:*` dependencies). Three packages share one `node_modules`:

```
obsidian-remotion-workspace/
├── package.json                   # Root workspace config
├── node_modules/                  # Shared for all packages
├── remotion-md/                   # Published npm package
│   ├── package.json
│   ├── src/                       # Source: extraction, synthesis, compiler
│   ├── dist/                      # Built output (git-ignored)
│   └── tsconfig.json
├── obsidian-remotion/             # Obsidian plugin
│   ├── package.json
│   ├── src/                       # Plugin entry, preview view, bundler
│   ├── main.js                    # Built plugin (git-ignored, ~500KB)
│   ├── tsconfig.json
│   └── rollup.config.js
└── examples/                      # Test vault
    ├── package.json
    └── ...
```

### Build Order & Dependency Graph

```
TypeScript Dependencies:
  obsidian-remotion → remotion-md

Build Order:
  1. remotion-md:build         (compile src/ to dist/)
  2. obsidian-remotion:build   (bundle dist/ + deps into main.js)
```

**Root script does ordered builds:**
```bash
npm run build
  ↓
npm run build -w remotion-md    # TypeScript → dist/
  ↓
npm run build -w obsidian-remotion  # Rollup main.ts + node_modules → main.js
```

### Package Exports

**remotion-md** (for npm publishing):
- **main:** `dist/index.js` (CommonJS)
- **types:** `dist/index.d.ts` (TypeScript declarations + source maps)
- **files:** `["dist"]` (only dist/ published to npm)
- **scripts:** `build` (tsc), `clean` (rm dist/), `test` (jest)

**obsidian-remotion** (Obsidian plugin):
- **main:** `main.js` (plugin entry, not published)
- **format:** CommonJS (required by Obsidian)
- **external:** `obsidian`, `react`, `react-dom`, `remotion`, `@remotion/player` (resolved from vault at runtime)
- **bundled:** `remotion-md`, Rollup, TypeScript Compiler
- **size:** ~500KB (lean, no heavy dependencies)

---

## Dependency Architecture: Plugin vs Vault

### Design Philosophy

The plugin is **not** a runtime container. It's an **editor integration layer** that:
- Orchestrates Markdown extraction and TypeScript compilation
- Manages the iframe and message passing
- Resolves and invokes Remotion from the vault environment

**This separation enables:**
- ✅ Smaller plugin size (500KB vs 3.7MB)
- ✅ User control over Remotion versions
- ✅ Independent Remotion updates without plugin rebuilds
- ✅ Clearer concerns: plugin = editor, vault = execution

### Bundling Strategy

#### 1. Plugin Build (main.js)
**Goal:** Lightweight editor integration, no runtime container.

```
Rollup (rollup.config.js)
├── Input: src/main.ts
├── External (from vault at runtime):
│   ├─ obsidian (provided by Obsidian)
│   ├─ react (vault node_modules)
│   ├─ react-dom (vault node_modules)
│   ├─ remotion (vault node_modules)
│   └─ @remotion/player (vault node_modules)
├── Bundled (plugin tools):
│   ├─ remotion-md (extraction, synthesis, compilation)
│   ├─ rollup (for user code bundling)
│   └─ typescript (compiler API)
└── Output: main.js (CommonJS, ~500KB)
```

**What's NOT bundled:**
- React (users install in vault)
- Remotion (users install in vault)
- @remotion/player (users install in vault)

**Why Rollup is bundled:**
- Plugin needs to bundle user code at runtime
- When vault has `node_modules`, plugin uses Rollup to resolve imports
- Rollup runs in-memory, no disk writes

#### 2. Preview Bundling (per-note, in-memory)
**Goal:** Bundle user's TSX code with vault's `node_modules`.

```
Rollup (src/bundler.ts)
├── Input: Virtual module (synthesized TSX)
├── External: React, Remotion (resolved from vault node_modules)
├── Bundled: User's @remotion/transitions, custom packages
└── Output: IIFE bundle (string, sent to iframe)
```

**Resolution Strategy:**
1. Check if vault has `package.json`
2. Walk up from note location to find nearest `node_modules/`
3. Pass to Rollup's `node-resolve` plugin
4. If no vault setup, bundling fails (fails gracefully with helpful error)

**Why load React/Remotion from vault?**
- User controls versions independently of plugin
- Multiple vaults can use different Remotion versions
- No version conflicts between plugin and user code
- Smaller plugin bundle overall

### Dependency Matrix

| Package | Lives In | Loaded By |
|---------|----------|-----------|
| remotion-md | Plugin bundle | Direct require() |
| rollup | Plugin bundle | Direct require() |
| typescript | Plugin bundle | Direct require() |
| obsidian | Obsidian runtime | External |
| react | Vault node_modules | User code (bundled into user bundle) |
| remotion | Vault node_modules | User code (bundled into user bundle) |
| @remotion/player | Vault node_modules | User code (bundled into user bundle) |
| @remotion/transitions | Vault node_modules | User imports in `.md` |

### What If Vault Doesn't Have Dependencies?

The plugin will fail gracefully with an error message:
- "Cannot find module 'react'" → User knows to run `npm install react`
- "Cannot find module '@remotion/player'" → User knows to add it to vault

This is intentional: the plugin does not try to bundle these dependencies. Users are responsible for vault setup.

---

## Vault Setup Guide

To use the plugin, **you must set up npm in your vault**:

```bash
cd /path/to/vault
npm init -y
npm install remotion react react-dom @remotion/player
# Optionally:
npm install @remotion/transitions @remotion/skia  # etc.
```

**What this means:**
- Vault root contains `package.json` and `node_modules/`
- Plugin resolves dependencies from this directory at runtime
- You can upgrade Remotion versions anytime without updating the plugin
- Different vaults can use different Remotion versions simultaneously

**Short answer:** Not yet. The plugin only provides **live preview**.

**Why not?**
- Video rendering requires `@remotion/renderer` (Node.js-based)
- Obsidian plugins run in renderer process (Chromium), not Node
- `@remotion/renderer` needs FFmpeg, Puppeteer, etc.

**Future Options:**
1. **CLI tool** (`remotion-md render`) — runs in Node, outside Obsidian
2. **Plugin exports** — "Export to Remotion project" button
3. **Server mode** — Plugin talks to local server that does rendering

For now, users can:
- Copy compiled code from preview panel
- Paste into standard Remotion project
- Run `npx remotion render`

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     User's Obsidian Vault                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  MyScene.md                                                        │
│  package.json           ┌─ node_modules/                          │
│  node_modules/          │  ├─ react                              │
│  ├─ react               │  ├─ remotion                           │
│  ├─ remotion            │  ├─ @remotion/player                   │
│  ├─ @remotion/player    │  ├─ @remotion/transitions (optional)  │
│  └─ @remotion/...       │  └─ other packages                     │
└───────────────┬─────────┴──────────────────────────────────────┬─┘
                │                                                │
                │                                                │
     ┌──────────▼──────────┐                       ┌─────────────▼────────┐
     │ Plugin Logic        │ ◄──────────────────► │ Runtime Environment   │
     │ (main.js)           │  Resolve imports     │ (vault node_modules)  │
     │                     │  at runtime          │                       │
     │ • Extract markdown  │                      │ Executes:             │
     │ • Compile TypeScript│                      │ • React code          │
     │ • Bundle user code  │                      │ • Remotion scenes     │
     │ • Manage iframe     │                      │ • Preview rendering   │
     └──────────┬──────────┘                      │                       │
                │                                 └────────────────────────┘
                │
                ▼
     ┌──────────────────────┐
     │  Preview Iframe      │
     ├──────────────────────┤
     │ Bundled user code    │
     │ + imports from       │
     │  vault node_modules  │
     │                      │
     │ <Player />           │
     │ ├─ Remotion renders  │
     │ └─ Scene N           │
     └──────────────────────┘
```

**Key distinction:**
- **Plugin** (left): Editor integration, compilation, bundling logic
- **Vault** (right): Runtime environment with npm dependencies
- **Iframe** (bottom): Isolated context rendering user's scenes

---

## FAQ

### Why isn't Remotion bundled in the plugin?

**By design.** The plugin is an editor integration, not a runtime container.

**Benefits of external dependencies:**
- ✅ Smaller plugin (500KB vs 3.7MB)
- ✅ User controls Remotion version
- ✅ Faster plugin updates (don't rebuild with Remotion)
- ✅ Multiple vaults can use different versions
- ✅ Clearer separation: plugin = editor, vault = execution

**Downside:** Users must run `npm install remotion` in vault (documented in setup).

### What if my vault doesn't have npm set up?

The plugin will fail with a clear error:
```
Cannot find module 'react' in vault node_modules
Please run: cd /path/to/vault && npm install remotion react react-dom @remotion/player
```

This is intentional — it tells users exactly what to do.

### Can React and Remotion versions conflict?

- ✅ Type checking and error display
- ❌ Video export (.mp4, .webm, etc.)

**Why no video export?**
- Video rendering requires `@remotion/renderer` (Node.js + FFmpeg + Puppeteer)
- Obsidian plugins run in renderer process, not Node.js main process
- Would need ~500MB of dependencies (FFmpeg, Chromium)

**Planned solutions:**
1. CLI tool: `remotion-md render MyScene.md output.mp4` (runs in Node)
2. Export button: "Copy to Remotion project" → user runs `npx remotion render`
3. Server mode: Plugin communicates with local render server

### Where do packages go?

| Package | Location | Purpose |
|---------|----------|---------|
| `react`, `react-dom` | Vault `node_modules` | Runtime dependency, user-controlled |
| `remotion`, `@remotion/player` | Vault `node_modules` | Runtime dependency, user-controlled |
| `@remotion/transitions` | Vault `node_modules` | Optional, user's choice |
| `typescript` | Plugin bundle | Compilation at build time |
| `remotion-md` | Plugin bundle | Extraction, synthesis, compilation |
| `rollup` | Plugin bundle | Bundling user code at runtime |

**In other words:** Plugin has no runtime dependencies on React or Remotion. All user code runs against vault's installation.

### Can I use remotion-md without Obsidian?

**Yes, in the future.** Current status:

- ✅ Core API: `extractCodeBlocks()`, `synthesizeVirtualModule()`, `compileVirtualModule()`
- ✅ Standalone package: Can be imported into any Node.js project
- ❌ Webpack/Vite loader: Not yet implemented
- ❌ CLI tool: Not yet implemented

**Planned usage:**
```typescript
// Vanilla Remotion project
import { registerMarkdownLoader } from 'remotion-md/vite';

export default {
  plugins: [registerMarkdownLoader()]
};

// Then:
import scene from './MyScene.md';  // Works!
```

### Use Case Matrix

| Use Case | Setup Required | Remotion Source | Notes |
|----------|---|---|---|
| **Basic Preview** | `npm install remotion react` in vault | Vault `node_modules` | Default; user controls version |
| **Advanced Preview** | + `npm install @remotion/transitions` | Vault `node_modules` | Add packages, no plugin rebuild needed |
| **Vanilla Remotion** | Standard `npm init remotion` project | Project `node_modules` | Use `remotion-md` package directly (future) |
| **CLI Rendering** | `npm install @remotion/renderer` | Global/npx | Render to MP4/WebM (future, non-Obsidian) |
| **Development** | `npm install` at workspace root | Monorepo + vault | Contributing to plugin, testing |

---

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
