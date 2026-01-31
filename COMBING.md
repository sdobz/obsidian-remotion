# Combing: Semantic Gradient Refactoring

## Overview

**Combing** is a systematic refactoring methodology that reduces codebase complexity through semantic gradient architecture and tangle elimination. The goal is to create a layered structure where each layer has a clear purpose, dependencies flow downward, and modules are sized for human comprehension.

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

**Wiring Layer**: Orchestrates components and manages lifecycle. Handles framework integration and event wiring. Minimal logic, maximum connections.

**Presentation Layer**: UI components and view logic. API boundaries and protocol handling. Coordinates between wiring and domain layers.

**Domain Layer**: Pure business logic and transformations. Self-contained algorithms. Minimal external dependencies.

## Identifying Tangles

**Tangles** are inappropriate dependencies that violate the semantic gradient:

- **Reverse Dependencies**: Domain layer depending on presentation layer
- **Sideways Dependencies**: Presentation modules directly coupled
- **Scattered Responsibilities**: Related functionality split across files
- **God Objects at Wrong Level**: Domain logic embedded in presentation layer

## Detection Strategy

Use import analysis to visualize dependencies, line count analysis to identify candidates for splitting or merging, and responsibility mapping to ensure single clear purposes.

## Combing Process

### Phase 1: Identify Tangles

Map current imports, categorize files into semantic layers, mark violations where dependencies point upward or sideways, list scattered responsibilities.

### Phase 2: Plan Domains

Design cohesive modules for each semantic layer. Target 7-10 total files at 100-300 lines each.

### Phase 3: Create Semantic Domains

**Order matters**: Build from bottom up. Extract utilities first, create domain modules, build presentation layer, refactor wiring last. Each step imports only from layers below.

### Phase 4: Execute Refactoring

Create skeleton interfaces, copy relevant code, update imports, delete old files only after verification.

### Phase 5: Verify

Build succeeds, no circular dependencies, line counts in range, tests pass, functionality preserved.

## Common Patterns

- **Extract Pure Utilities**: Create dedicated modules for shared functionality
- **Merge Scattered Concerns**: Consolidate related responsibilities
- **Sink Heavy Logic**: Move algorithms from presentation to domain layer
- **Break God Objects**: Split by semantic layer
- **Eliminate Adapters**: Move transformations to consumer or provider

## Anti-Patterns to Avoid

❌ **The Mega-Merge**: Don't merge everything into one file
❌ **Premature Abstraction**: Only extract what exists today
❌ **Interface Explosion**: Don't over-specify contracts
❌ **Util Dumping**: Don't create catch-all utility files
❌ **Rename Without Refactor**: Must fix dependency structure, not just names

## When to Comb

**Triggers**: Feature requires touching many files, hard to understand file purpose, frequent merge conflicts, files growing too large, copying code between files.

**When NOT to comb**: Code rarely changes, under time pressure, before understanding domain deeply, when tests don't exist.

## Summary

**Combing** = Semantic gradient + Tangle elimination + Size optimization

The goal is **sustainable comprehension**. Code should be organized so that finding and modifying behavior is straightforward, and the dependency graph flows cleanly down the semantic gradient.
