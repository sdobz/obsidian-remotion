/**
 * Integration tests for bundler - reproduces actual Obsidian flow
 * 
 * Tests the complete flow: markdown → compilation → bundling → bundle for iframe
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestHarness } from "../test-harness";
import { loadEsbuild, bundleTypeScriptSource } from "../bundler";
import * as path from "path";

describe("Bundler Integration", () => {
    let harness: TestHarness;

    beforeEach(() => {
        harness = new TestHarness();
        harness.installStubbedDependencies();
    });

    afterEach(() => {
        harness.cleanup();
    });

    it("should produce a runtime bundle", async () => {
        // Minimal bundle - just the bundle wrapper code
        const esbuild = loadEsbuild([path.join(harness.vault.root, "node_modules")]);

        expect(esbuild).not.toBeNull();

        // Bundle a simple empty module
        const sourceText = "export const empty = {};";
        const result = await bundleTypeScriptSource(
            sourceText,
            "Empty.tsx",
            esbuild,
            {
                nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(result.code).toBeTruthy();
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.error).toBeUndefined();
    });

    it("should produce a runtime bundle with user code", async () => {
        const markdown = `
\`\`\`tsx
export const MyComponent = () => <div>Hello</div>;
\`\`\`
`;

        const result = harness.compile(markdown);
        expect(result.code).toBeTruthy();

        const nodeModulesPaths = [path.join(harness.vault.root, "node_modules")];
        const esbuild = loadEsbuild(nodeModulesPaths);

        expect(esbuild).not.toBeNull();

        const bundle = await bundleTypeScriptSource(
            result.synthesizedSource,
            "Test.md.tsx",
            esbuild,
            {
                nodeModulesPaths,
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(bundle.code).toBeTruthy();
        expect(bundle.code).toContain("RemotionBundle");
        expect(bundle.error).toBeUndefined();
    });

    it("should produce a runtime bundle with user code and user dependencies", async () => {
        const markdown = `
\`\`\`tsx
import React from 'react';

export const MyComponent = () => <div>Hello from React</div>;
\`\`\`
`;

        const result = harness.compile(markdown);
        expect(result.code).toBeTruthy();

        const nodeModulesPaths = [path.join(harness.vault.root, "node_modules")];
        const esbuild = loadEsbuild(nodeModulesPaths);

        expect(esbuild).not.toBeNull();

        const bundle = await bundleTypeScriptSource(
            result.synthesizedSource,
            "Test.md.tsx",
            esbuild,
            {
                nodeModulesPaths,
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(bundle.code).toBeTruthy();
        // Should have both the user code and React bundled together in IIFE
        expect(bundle.code).toContain("RemotionBundle");
        expect(bundle.code.length).toBeGreaterThan(1000); // React adds substantial code
        expect(bundle.error).toBeUndefined();
    });
});