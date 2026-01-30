# Combing: Semantic Gradient Refactoring

## Overview

**Combing** is a systematic refactoring methodology that reduces codebase complexity through semantic gradient architecture and tangle elimination. The goal is to create a layered structure where each layer has a clear purpose, dependencies flow downward, and modules are sized for human comprehension (100-300 lines).

## The Semantic Gradient

Code naturally organizes into semantic layers based on abstraction level:

```
BROAD/SHALLOW (Wiring Layer)
    ↓
MEDIUM (Presentation/Coordination)
    ↓
NARROW/DEEP (Domain Logic/Pure Functions)
```

### Layer Characteristics

**Wiring Layer (Broad)**

- Orchestrates components and manages lifecycle
- Handles framework integration and event wiring
- Minimal logic, maximum connections
- Examples: `main.ts`, plugin entry points, route handlers

**Presentation Layer (Medium)**

- UI components and view logic
- API boundaries and protocol handling
- Coordinates between wiring and domain layers
- Examples: `preview.ts`, `ui.ts`, `editor.ts`

**Domain Layer (Deep)**

- Pure business logic and transformations
- Self-contained algorithms
- Minimal external dependencies
- Examples: `compilation.ts`, `bundler.ts`, `config.ts`

## Identifying Tangles

**Tangles** are inappropriate dependencies that violate the semantic gradient. They manifest as:

### 1. **Reverse Dependencies**

```typescript
// BAD: Deep domain importing from presentation
import { PreviewView } from "./preview"; // in bundler.ts
```

The domain layer should never depend on the presentation layer.

### 2. **Sideways Dependencies**

```typescript
// BAD: Presentation modules directly coupled
import { ScrollManager } from "./scrollManager"; // in previewView.ts
```

If modules at the same level need each other's code, they belong in the same module.

### 3. **Scattered Responsibilities**

```typescript
// BAD: Same concern split across files
// editorAccessor.ts - gets EditorView
// editorDiagnostics.ts - uses EditorView
```

Related functionality should be colocated.

### 4. **God Objects at Wrong Level**

```typescript
// BAD: Presentation layer doing domain logic
class PreviewView {
  compile() {
    /* 200 lines of compilation */
  }
  render() {
    /* ... */
  }
}
```

Compilation is domain logic, not view responsibility.

## Detection Strategy

### 1. **Import Analysis**

Generate a dependency matrix:

```bash
# For each .ts file, list what it imports
for f in src/*.ts; do
  echo "=== $(basename $f) ==="
  grep "^import.*from.*\"\.\/" $f
done
```

Look for:

- Domain files importing presentation files
- Circular dependencies
- Many files importing the same utility (extract it)

### 2. **Line Count Analysis**

```bash
wc -l src/*.ts | sort -n
```

Files over 300 lines are candidates for splitting. Files under 50 lines might be merge candidates.

### 3. **Responsibility Mapping**

For each file, answer:

- What is its single primary purpose?
- Does it have multiple unrelated purposes? (Split)
- Do other files share this purpose? (Merge)

## Combing Process

### Phase 1: Identify Tangles

1. **Map current imports** to visualize dependencies
2. **Categorize each file** into semantic layers
3. **Mark violations** where dependencies point upward or sideways inappropriately
4. **List responsibilities** that are scattered across files

### Phase 2: Plan Domains

For each semantic layer, design cohesive modules:

**Wiring Layer** (1-2 files)

- Main entry point
- Framework lifecycle management

**Presentation Layer** (3-5 files)

- One file per UI concern (views, editor, status bars, settings)
- Protocol boundaries (API clients, iframe communication)

**Domain Layer** (3-5 files)

- One file per core transformation
- Pure utilities and configuration

Target: **7-10 total files** at 100-300 lines each

### Phase 3: Create Semantic Domains

**Order matters**: Build from bottom up.

1. **Extract utilities first** (config, helpers)
   - No dependencies on application code
   - Pure functions and constants

2. **Create domain modules** (compilation, bundling)
   - Import only utilities
   - Export data structures and transformations

3. **Build presentation layer** (views, UI components)
   - Import from domain layer
   - Export interfaces for wiring layer

4. **Refactor wiring last** (main entry point)
   - Import from all layers
   - Minimal logic, maximum delegation

### Phase 4: Execute Refactoring

For each new domain file:

```typescript
// 1. Create skeleton with interface
export interface DomainResult {
  // ... types
}

export class DomainManager {
  // ... public API
}

// 2. Copy relevant code from old files
// 3. Update imports to use new structure
// 4. Delete old files only after verification
```

**Critical**: Update imports before deleting old files.

### Phase 5: Verify

1. **Build succeeds**: `npm run build` with no errors
2. **No circular dependencies**: Check with import analysis
3. **Line counts in range**: 100-300 lines per file (some flexibility for complex domains)
4. **Tests pass**: If you have them
5. **Functionality preserved**: Manual testing of key paths

## Measuring Success

Before/After metrics:

| Metric               | Before | After | Target  |
| -------------------- | ------ | ----- | ------- |
| Total files          | ?      | ?     | 7-10    |
| Lines per file (avg) | ?      | ?     | 150-250 |
| Import tangles       | ?      | ?     | 0       |
| Circular deps        | ?      | ?     | 0       |
| Max file lines       | ?      | ?     | <400    |

## Common Patterns

### Pattern 1: Extract Pure Utilities

**When**: Multiple files need same helper function
**Action**: Create dedicated utilities module at bottom of gradient

### Pattern 2: Merge Scattered Concerns

**When**: 3+ files all deal with same domain (e.g., editor*, scroll*)
**Action**: Merge into single cohesive module

### Pattern 3: Sink Heavy Logic

**When**: Presentation layer has >50 lines of algorithm
**Action**: Extract to domain layer, pass result back up

### Pattern 4: Break God Objects

**When**: One file has >500 lines with multiple concerns
**Action**: Split by semantic layer - wiring stays, logic sinks, UI moves to presentation

### Pattern 5: Eliminate Adapters

**When**: Small files that just transform between two others
**Action**: Move transformation to the consumer or provider

## Anti-Patterns to Avoid

❌ **The Mega-Merge**: Don't merge everything into one file

- Still respect semantic layers
- Keep unrelated concerns separate

❌ **Premature Abstraction**: Don't create domains for future needs

- Only extract what exists today
- YAGNI applies

❌ **Interface Explosion**: Don't over-specify contracts

- Use TypeScript structural typing
- Interfaces where necessary, not everywhere

❌ **Util Dumping**: Don't create "utils.ts" catch-all

- Name by domain: `editorUtils.ts`, `pathUtils.ts`
- Or merge into the module that uses them most

❌ **Rename Without Refactor**: Changing file names isn't combing

- Must also fix dependency structure
- Must consolidate related responsibilities

## Example: Obsidian Remotion Plugin

**Before** (11 files, 1407 lines):

- Tangles: compilation → preview, editor files scattered, settings split
- Issues: God object (compilationManager 400+ lines), micro-modules (settings 10 lines)

**After** (7 files, 1350 lines):

1. `main.ts` (158) - Wiring layer
2. `preview.ts` (276) - Preview iframe management
3. `ui.ts` (261) - All UI concerns (views, scroll, status, settings)
4. `editor.ts` (130) - CodeMirror integration
5. `compilation.ts` (327) - Compilation pipeline
6. `bundler.ts` (132) - esbuild orchestration
7. `config.ts` (66) - Settings and utilities

**Results**:

- 0 import tangles
- Clear semantic layers
- Each file has single clear purpose
- 57 lines saved through eliminating duplication

## Workflow Commands

```bash
# Find files to analyze
find src -name "*.ts" ! -name "*.test.ts" | sort

# Count lines per file
wc -l src/*.ts | sort -n

# See imports
grep -h "^import.*from.*\"\.\/" src/*.ts | sort | uniq -c | sort -rn

# Find potential duplicates (same function names)
grep -oh "export \(function\|class\|interface\) \w\+" src/*.ts | sort | uniq -c | grep -v "^      1"

# Check for circular dependencies (requires madge)
npx madge --circular --extensions ts src/
```

## When to Comb

**Triggers for combing**:

- Adding feature requires touching 5+ files
- Hard to understand what a file does
- Frequent merge conflicts in same files
- File growing past 400 lines
- Copying code between files

**When NOT to comb**:

- Code works and rarely changes
- Under time pressure (refactor later)
- Before understanding domain deeply
- When tests don't exist (write first)

## Summary

**Combing** = Semantic gradient + Tangle elimination + Size optimization

1. **Identify** tangles through import analysis
2. **Plan** semantic domains (7-10 files, 100-300 lines)
3. **Build** from bottom up (utils → domain → presentation → wiring)
4. **Verify** builds, no tangles, tests pass
5. **Measure** line counts and dependency health

The goal is not perfection, but **sustainable comprehension**. Code should be organized so that finding and modifying behavior is straightforward, and the dependency graph flows cleanly down the semantic gradient.
