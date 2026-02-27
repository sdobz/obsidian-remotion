import { bundleTypeScriptSource, loadEsbuild } from "../bundler";
import { ResolutionContext } from "../resolution-context";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * Integration test: esbuild can discover npm dependencies
 *
 * This test verifies that when we bundle code that imports npm packages,
 * we can discover what those packages are.
 */

describe("Dependency discovery via esbuild", () => {
    it("should discover jsx-runtime and package dependencies", async () => {
        // Create a temporary vault structure
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "remotion-test-"));

        try {
            const filePath = path.join(tmpDir, "Test.md");

            // Create source code that imports npm packages
            const sourceCode = `
import React from "react";
import { Composition } from "@remotion/core";

export const MyComposition = () => _jsx(Composition, {});
`;

            const virtualFileName = filePath + ".tsx";

            // Set up resolution context
            const resolutionContext = new ResolutionContext(tmpDir, filePath);

            // Load esbuild
            const esbuild = loadEsbuild(resolutionContext);
            if (!esbuild) {
                throw new Error("esbuild not available");
            }

            // Bundle the code
            const bundleResult = await bundleTypeScriptSource(
                sourceCode,
                virtualFileName,
                esbuild,
                resolutionContext,
                filePath,
                `# Test\n\n\`\`\`tsx\n${sourceCode}\n\`\`\``,
            );

            // Should have bundled successfully
            expect(bundleResult.code).toBeTruthy();
            expect(bundleResult.code.length).toBeGreaterThan(100);

            // bundledModules should include external imports needed at runtime
            expect(bundleResult.bundledModules).toBeDefined();
            expect(bundleResult.bundledModules?.has("react")).toBe(true);
            expect(bundleResult.bundledModules?.has("react/jsx-runtime")).toBe(true);
            expect(bundleResult.bundledModules?.has("@remotion/core")).toBe(true);
        } finally {
            // Clean up temporary directory
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
