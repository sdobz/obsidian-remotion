/**
 * Integration tests for bundler - reproduces actual Obsidian flow
 * 
 * Tests the complete flow: markdown → compilation → bundling → dependency injection
 * This should catch the runtime errors we're seeing in Obsidian.
 */

import { TestHarness } from "../test-harness";
import { loadEsbuild, bundleTypeScriptSource, bundleDependenciesBundle } from "../bundler";
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

    it("should bundle user code and dependencies separately", async () => {
        // Create a markdown file with React and Remotion imports
        const markdown = `
\`\`\`tsx
import React from 'react';
import { Player } from '@remotion/player';

export const MyComponent = () => (
  <Player
    component={() => <div>Hello</div>}
    durationInFrames={30}
    fps={30}
    compositionWidth={1920}
    compositionHeight={1080}
  />
);
\`\`\`
`;

        // Step 1: Compile the markdown
        const result = harness.compile(markdown);

        expect(result.code).toBeTruthy();

        // Step 2: Bundle user code with esbuild
        const esbuild = loadEsbuild({
            nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
            resolutionDirectory: harness.vault.root,
        });

        expect(esbuild).not.toBeNull();

        const userBundle = await bundleTypeScriptSource(
            result.synthesizedSource,
            "Test.md.tsx",
            esbuild,
            {
                nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(userBundle.code).toBeTruthy();
        expect(userBundle.bundledModules).toBeDefined();
        expect(userBundle.bundledModules!.size).toBeGreaterThan(0);

        // Step 3: Bundle dependencies
        const moduleIds = Array.from(userBundle.bundledModules!);
        const depsBundle = await bundleDependenciesBundle(
            moduleIds,
            esbuild,
            {
                nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(depsBundle.code).toBeTruthy();
        expect(depsBundle.code.length).toBeGreaterThan(100);

        // Step 4: Verify the dependencies bundle has the expected structure
        expect(depsBundle.code).toContain("__REMOTION_DEPS_BUNDLE__");

        // Verify each module is exported
        moduleIds.forEach((moduleId, index) => {
            expect(depsBundle.code).toContain(`m${index}`);
        });
    });

    it("should handle the exact module list from the error", async () => {
        // The error shows: @remotion/player at index 0, react/jsx-runtime at index 1, react at index 2
        const moduleIds = ["@remotion/player", "react/jsx-runtime", "react"];

        const esbuild = loadEsbuild({
            nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
            resolutionDirectory: harness.vault.root,
        });

        expect(esbuild).not.toBeNull();

        const depsBundle = await bundleDependenciesBundle(
            moduleIds,
            esbuild,
            {
                nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(depsBundle.code).toBeTruthy();
        expect(depsBundle.code.length).toBeGreaterThan(100);
        expect(depsBundle.code).toContain("__REMOTION_DEPS_BUNDLE__");

        // Critical: Verify the exports structure matches what iframe expects
        // The iframe code expects: __REMOTION_DEPS_BUNDLE__.m0, .m1, .m2
        expect(depsBundle.code).toContain("m0");
        expect(depsBundle.code).toContain("m1");
        expect(depsBundle.code).toContain("m2");

        // Parse the bundle to check it's valid JavaScript
        expect(() => {
            new Function(depsBundle.code);
        }).not.toThrow();
    });

    it("should exclude bare markdown imports from dependency bundling", async () => {
        const markdown = `
\`\`\`tsx
import React from 'react';
import { Player } from 'Player.md';

export const MyComponent = () => <Player />;
\`\`\`
`;

        const result = harness.compile(markdown);

        const esbuild = loadEsbuild({
            nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
            resolutionDirectory: harness.vault.root,
        });

        const userBundle = await bundleTypeScriptSource(
            result.synthesizedSource,
            "Test.md.tsx",
            esbuild,
            {
                nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
                resolutionDirectory: harness.vault.root,
            }
        );

        expect(userBundle.bundledModules).toBeDefined();
        expect(userBundle.bundledModules?.has("Player.md")).toBe(false);
    });

    it("should produce a bundle that can be executed", async () => {
        const moduleIds = ["react", "react/jsx-runtime"];

        const esbuild = loadEsbuild({
            nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
            resolutionDirectory: harness.vault.root,
        });

        const depsBundle = await bundleDependenciesBundle(
            moduleIds,
            esbuild!,
            {
                nodeModulesPaths: [path.join(harness.vault.root, "node_modules")],
                resolutionDirectory: harness.vault.root,
            }
        );

        // The bundle creates `var __REMOTION_DEPS_BUNDLE__ = ...`
        // We need to eval it in a context where we can access that variable
        let capturedBundle: any;
        const sandbox = {
            get __REMOTION_DEPS_BUNDLE__() {
                return capturedBundle;
            },
            set __REMOTION_DEPS_BUNDLE__(value: any) {
                capturedBundle = value;
            }
        };

        // Execute in a way that captures the var
        const func = new Function("__REMOTION_DEPS_BUNDLE__", depsBundle.code + "; return __REMOTION_DEPS_BUNDLE__;");
        const result = func(sandbox.__REMOTION_DEPS_BUNDLE__);

        // Verify the bundle object exists and has the expected structure
        expect(result).toBeDefined();
        expect(result.m0).toBeDefined();
        expect(result.m1).toBeDefined();

        // Verify m1 has jsx-runtime exports (jsx, jsxs, Fragment)
        expect(result.m1.jsx).toBeDefined();
        expect(result.m1.jsxs).toBeDefined();
        expect(result.m1.Fragment).toBeDefined();
    });
});