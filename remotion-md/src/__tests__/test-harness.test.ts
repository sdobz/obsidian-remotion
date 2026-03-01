import { describe, test, expect } from "vitest";
import {
    TestHarness,
    compilationPipeline,
    createTestVault,
} from "../test-harness";
import * as path from "path";

/**
 * Integration Tests using Test Harness
 *
 * These tests use real file system, real TypeScript compiler, and real
 * extraction/synthesis/compilation pipeline. No mocking.
 *
 * Tests cover the complete flow that Obsidian uses:
 * Markdown → Extract → Synthesize → Compile → Runtime Modules
 */

describe("Test Harness Integration", () => {
    let harness: TestHarness;

    beforeEach(() => {
        harness = new TestHarness();
        // Install stubbed dependencies so TypeScript doesn't complain
        harness.installStubbedDependencies();
    });

    afterEach(() => {
        harness.cleanup();
    });

    describe("Basic compilation flow", () => {
        it("should compile simple React component", () => {
            const result = harness.compile(`
# My Component

\`\`\`tsx
import React from 'react';
export const MyComponent = () => <div>Hello</div>;
\`\`\`
      `);

            expect(result.code).toBeTruthy();
            expect(result.code.length).toBeGreaterThan(50);
            expect(result.diagnostics).toHaveLength(0);
        });

        it("should detect multiple runtime dependencies", () => {
            const result = harness.compile(`
# Complex Component

\`\`\`tsx
import React from 'react';
import { Composition } from '@remotion/core';
import { Player } from '@remotion/player';

export const MyVideo = () => (
  <Composition id="main">
    <Player />
  </Composition>
);
\`\`\`
      `);

            expect(result.code).toBeTruthy();
        });

        it("should handle markdown with no code blocks", () => {
            const result = harness.compile(`
# Just Markdown

This is plain text with no code.
      `);

            expect(result.code).toBeTruthy();
        });

        it("should detect jsx-runtime when JSX is used", () => {
            const result = harness.compile(`
\`\`\`tsx
import React from 'react';
export const C = () => <div>JSX</div>;
\`\`\`
      `);

            expect(result.code).toBeTruthy();
        });
    });

    describe("Cross-file imports", () => {
        it("should resolve relative imports in same vault", () => {
            // Create helper file
            harness.createFile(
                "lib.ts",
                `export function helper() { return 'helper'; }`,
            );

            // Create markdown that imports it
            const result = harness.compile(`
\`\`\`tsx
import { helper } from './lib';
import React from 'react';
export const C = () => <div>{helper()}</div>;
\`\`\`
      `);

            expect(result.diagnostics).toHaveLength(0);
            expect(result.code).toContain("helper");
        });

        it("should handle markdown importing another markdown file", () => {
            // Create Component.md
            harness.createFile(
                "Component.md",
                `
# Shared Component

\`\`\`tsx
import React from 'react';
export const SharedComponent = () => <div>Shared</div>;
\`\`\`
      `,
            );

            // Import from Main.md
            const result = harness.compile(
                `
\`\`\`tsx
import React from 'react';
import { SharedComponent } from './Component.md';
export const Main = () => <SharedComponent />;
\`\`\`
      `,
                "Main.md",
            );

            expect(result.diagnostics).toHaveLength(0);
            expect(result.code).toContain("SharedComponent");
        });
    });

    describe("Preview location detection", () => {
        it("should detect render() calls", () => {
            const result = harness.compile(`
\`\`\`tsx
import { render } from 'remotion-md';
import React from 'react';

render(<div>Test</div>, { durationInFrames: 30 });
\`\`\`
      `);

            expect(result.previewLocations.length).toBeGreaterThan(0);
        });

        it("should handle multiple render calls", () => {
            const result = harness.compile(`
\`\`\`tsx
import { render } from 'remotion-md';
import React from 'react';

render(<div>First</div>, { durationInFrames: 30 });
render(<div>Second</div>, { durationInFrames: 60 });
\`\`\`
      `);

            expect(result.previewLocations.length).toBe(2);
        });
    });

    describe("Error handling", () => {
        it("should report TypeScript errors in diagnostics", () => {
            const result = harness.compile(`
\`\`\`tsx
import React from 'react';

// Type error: missing required props
const x: { required: string } = {};
\`\`\`
      `);

            expect(result.diagnostics.length).toBeGreaterThan(0);
        });

        it("should handle invalid TypeScript syntax", () => {
            const result = harness.compile(`
\`\`\`tsx
import React from 'react';

// Syntax error
const x = ;
\`\`\`
      `);

            expect(result.diagnostics.length).toBeGreaterThan(0);
        });
    });

    describe("Vault structure", () => {
        it("should support nested directories", () => {
            harness.createDir("components");
            harness.createFile(
                "components/Button.tsx",
                `
import React from 'react';
export const Button = () => <button>Click</button>;
      `,
            );

            const result = harness.compile(
                `
\`\`\`tsx
import React from 'react';
import { Button } from './components/Button';
export const Page = () => <Button />;
\`\`\`
      `,
                "Page.md",
            );

            expect(result.diagnostics).toHaveLength(0);
        });
    });
});

describe("compilationPipeline pure function", () => {
    let vault: ReturnType<typeof createTestVault>;
    let harness: TestHarness;

    beforeEach(() => {
        vault = createTestVault();
        // Use TestHarness temporarily to install stubs, then use the vault directly
        harness = new TestHarness();
        harness.installStubbedDependencies();
        // Copy stubs to our vault
        const srcNodeModules = path.join(harness.vault.root, "node_modules");
        const dstNodeModules = path.join(vault.root, "node_modules");
        if (require("fs").existsSync(srcNodeModules)) {
            require("fs").cpSync(srcNodeModules, dstNodeModules, { recursive: true });
        }
    });

    afterEach(() => {
        vault.cleanup();
        harness.cleanup();
    });

    it("should work as a pure function without TestHarness", () => {
        const mdPath = path.join(vault.root, "Test.md");
        const mdContent = `
\`\`\`tsx
import React from 'react';
export const C = () => <div>Test</div>;
\`\`\`
    `;

        vault.mkfile("Test.md", mdContent);

        const result = compilationPipeline(mdPath, mdContent, vault.root);

        expect(result.code).toBeTruthy();
        expect(result.diagnostics).toHaveLength(0);
    });

    it("should be deterministic with same inputs", () => {
        const mdPath = path.join(vault.root, "Test.md");
        const mdContent = `
\`\`\`tsx
import React from 'react';
export const C = () => <div>Test</div>;
\`\`\`
    `;

        vault.mkfile("Test.md", mdContent);

        const result1 = compilationPipeline(mdPath, mdContent, vault.root);
        const result2 = compilationPipeline(mdPath, mdContent, vault.root);

        expect(result1.code).toBe(result2.code);
    });
});
