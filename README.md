# Obsidian Remotion Preview Plugin

## Philosophy

Turn Markdown notes into **live Remotion previews**. The plugin is an **editor integration layer**, not a runtime container.

- Plugin: ~500KB (orchestrates compilation, manages UI)
- Vault: Your `node_modules` (React, Remotion — you control versions)
- Result: Lightweight plugin, full user control, no version conflicts

## Quick Start

### Users

**Setup vault once:**
```bash
cd /path/to/vault
npm init -y
npm install remotion react react-dom @remotion/player
```

**Create notes with TSX blocks:**
````markdown
```tsx
<div style={{ backgroundColor: 'red', width: 100, height: 100 }}>
  Hello!
</div>
```
````

**Open preview:** Command palette → "Toggle Remotion Preview"

### Developers

**Build:**
```bash
npm install
npm run dev        # Fast build (no minify)
npm run build      # Production build (minified)
npm run watch      # Watch mode
```

**Dev plugin in vault:**
```bash
ln -s $(pwd)/obsidian-remotion /path/to/vault/.obsidian/plugins/obsidian-remotion
```

## How It Works

1. Extract TypeScript code blocks from Markdown
2. Synthesize into virtual TSX module
3. Compile TypeScript to JavaScript
4. Bundle user code + vault's `node_modules` (React, Remotion)
5. Render in iframe with Remotion Player

## Advanced Usage

### Custom Remotion Packages

After vault setup, install additional packages:
```bash
cd /path/to/vault
npm install @remotion/transitions
```

Then import in notes:
````markdown
```tsx
import { fade } from '@remotion/transitions/fade';

<div style={{ opacity: fade() }}>
  Fading in...
</div>
```
````

## Packages

- **remotion-md** — Extract/synthesize/compile API (standalone library)
- **obsidian-remotion** — Obsidian plugin (bundles remotion-md + Rollup)
- **examples** — Test vault with Remotion + React pre-installed

## Build & Architecture

See [WORKSPACE.md](WORKSPACE.md) for:
- Build process details
- Monorepo structure
- Dependency graph
- Plugin architecture
