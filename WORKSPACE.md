# Build & Architecture

## Overview

Monorepo with 3 packages using npm workspaces:
- **remotion-md** — Markdown extraction/synthesis/compilation library
- **obsidian-remotion** — Obsidian plugin (bundles everything)
- **examples** — Development test vault

## Build Pipeline

### Step 1: Build remotion-md Library

**Command:** `npm run build -w remotion-md`  
**Input:** `src/**/*.ts`  
**Output:** `dist/**/*.{js,d.ts,map}`

TypeScript compiler outputs ESNext modules:
- `dist/index.js` — Main entry point
- `dist/index.d.ts` — TypeScript types
- Source maps for debugging

**Config:** `remotion-md/tsconfig.json`
- Target: ES2020 (modern browsers)
- Module: ESNext (tree-shakeable)
- Declaration: yes (generate `.d.ts`)

### Step 2: Build obsidian-remotion Plugin

**Command:** `npm run build -w obsidian-remotion`  
**Input:** `src/main.ts`  
**Output:** `main.js` (~500KB)

Rollup bundles plugin code:
```
src/main.ts
  + dist/**/*.js (remotion-md from step 1)
  + node_modules (react, remotion, rollup, etc.)
  ↓ (Rollup + plugins)
main.js (CommonJS)
```

**Config:** `obsidian-remotion/rollup.config.js`
- Format: CommonJS (required by Obsidian)
- External: obsidian (provided at runtime)
- Plugins: resolve, commonjs, json, typescript2, terser (dev only)

### Complete Build

**Command:** `npm run build`

Runs both steps in order:
```bash
npm run build -w remotion-md          # Step 1
npm run build -w obsidian-remotion    # Step 2 (depends on step 1)
```

## Dev vs Production

### Development Build

**Command:** `npm run dev` or `npm run watch`  
**Minification:** None (fast iteration)  
**Size:** ~700KB

```bash
npm run watch -w obsidian-remotion    # Watch mode
```

### Production Build

**Command:** `npm run build`  
**Minification:** Terser enabled (environment variable: `NODE_ENV=production`)  
**Size:** ~500KB  
**Environment:** Automatically set by build script

## Dependencies

### Workspace Packages

Root `package.json` has shared devDependencies:
- TypeScript
- Jest + ts-jest
- @types/* packages
- Rollup + plugins
- Terser

Each package accesses these (no duplication).

### Package Dependencies

| Package | Imports | Bundled? |
|---------|---------|----------|
| remotion-md | — | Library (not bundled) |
| obsidian-remotion | remotion-md | Yes (into main.js) |
| obsidian-remotion | react, remotion | Yes (into main.js) |
| obsidian-remotion | rollup, typescript | Yes (into main.js) |
| obsidian-remotion | obsidian | No (external - provided by Obsidian) |

**Why Rollup is bundled:** Plugin needs to bundle user TSX code at runtime.

**Why React/Remotion are bundled:** Plugin imports them for UI/rendering. Users install these in vault for their code to use.

## Monorepo Structure

```
obsidian-remotion-workspace/
├── package.json                 # Root: shared devDeps, workspace config
├── node_modules/                # Shared across all packages
├── remotion-md/
│   ├── package.json             # Exports: main, types, files
│   ├── src/
│   │   ├── extraction.ts        # Parse code blocks
│   │   ├── synthesis.ts         # Create virtual module
│   │   ├── compiler.ts          # TypeScript → JavaScript
│   │   └── index.ts             # Public API
│   ├── dist/                    # Built output (git-ignored)
│   └── tsconfig.json
├── obsidian-remotion/
│   ├── package.json             # Depends: remotion-md (workspace:*)
│   ├── manifest.json            # Obsidian plugin manifest
│   ├── src/
│   │   ├── main.ts              # Plugin entry point
│   │   ├── previewView.ts       # Side panel UI
│   │   ├── bundler.ts           # Runtime bundler
│   │   └── settings.ts          # Plugin settings
│   ├── main.js                  # Built plugin (git-ignored)
│   ├── rollup.config.js         # Bundler config
│   └── tsconfig.json
└── examples/
    ├── package.json             # Has react, remotion, @remotion/player
    └── *.md                     # Test markdown files
```

## Common Tasks

### Build everything
```bash
npm run build
```

### Watch for changes (dev)
```bash
npm run watch
```

### Clean build artifacts
```bash
npm run clean
npm run build
```

### Run tests
```bash
npm test
```

### Publish remotion-md to npm
```bash
# 1. Bump version in remotion-md/package.json
# 2. Build everything
npm run build
# 3. Publish library
npm publish -w remotion-md
```

## Troubleshooting

**Build fails with "Cannot find module"**
- Check tsconfig.json `include` paths
- Ensure remotion-md builds before obsidian-remotion
- Try `npm run clean && npm run build`

**Build is slow**
- Use `npm run watch` for iterative development
- Minification (terser) is only in production builds
- Dev builds should be ~2-3 seconds

**Plugin not loading in Obsidian**
- Ensure `main.js` exists and `manifest.json` references it
- Check Obsidian console for errors
- Symlink must be readable: `ls -la /path/to/vault/.obsidian/plugins/obsidian-remotion`
