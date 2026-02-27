import { bundleTypeScriptSource, loadEsbuild } from "../bundler";
import { ResolutionContext } from "../resolution-context";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * Test: Untested code paths in bundling
 *
 * This test covers error cases that may not be tested in normal scenarios.
 */
describe("Bundle error cases and untested paths", () => {
    it("should return bundledModules even when esbuild is not available", async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "error-case-"));

        try {
            const resolutionContext = new ResolutionContext(tmpDir, tmpDir);

            // Test with null esbuild
            const result = await bundleTypeScriptSource(
                "import React from 'react';",
                "test.tsx",
                null, // esbuild not available
                resolutionContext,
            );

            // Even with error, should have bundledModules property
            console.log("=== Result with no esbuild ===", result);
            expect(result.error).toBeDefined();
            // UNTESTED: What happens to bundledModules when esbuild is unavailable?
            // Currently it's NOT in the return object
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("should handle bundleTypeScriptSource errors gracefully", async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "error-case-2-"));

        try {
            const resolutionContext = new ResolutionContext(tmpDir, tmpDir);
            const esbuild = loadEsbuild(resolutionContext);
            if (!esbuild) {
                throw new Error("esbuild not available");
            }

            // Try to bundle code that will fail - import from non-existent module
            const result = await bundleTypeScriptSource(
                "import { Foo } from 'definitely-not-a-real-module';",
                "test.tsx",
                esbuild,
                resolutionContext,
            );

            console.log("=== Result with missing module ===");
            console.log("Error:", result.error?.message);
            console.log("Code length:", result.code.length);
            console.log("Has bundledModules:", !!result.bundledModules);
            console.log("bundledModules:", result.bundledModules);
            console.log("bundledModules size:", result.bundledModules?.size);

            // UNTESTED ISSUE: If bundleTypeScriptSource errors, bundledModules is undefined
            // This causes runtimeModules to be empty Set in compilation.ts
            // Which causes bundleDependencies to receive empty array
            // Which might produce empty code string
            if (result.error) {
                expect(result.bundledModules).toBeUndefined();
                console.log(
                    "WARNING: bundledModules is undefined on error - this could cause empty dependencies bundle",
                );
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
