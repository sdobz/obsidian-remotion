/**
 * @vitest-environment node
 */

import {
    BundlePipeline,
    loadEsbuild,
    ResolutionContext,
} from "remotion-md";
import path from "path";
import fs from "fs";
import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";

/**
 * Create a JSDOM instance with a container ready for runtime execution
 */
function createJsdomWindow() {
    const jsdom = new JSDOM("<!DOCTYPE html><body><div id='root'></div></body>", {
        runScripts: "dangerously",
        url: "http://localhost",
    });
    const window = jsdom.window as unknown as Window;
    const container = window.document.getElementById("root") as HTMLElement;

    return { jsdom, window, container };
}

describe("esbuild Bundling Integration", () => {
    const examplesDir = path.resolve(__dirname, "../../../../examples");
    const rootDir = path.resolve(__dirname, "../../../../");
    let esbuildInstance: any;

    beforeEach(() => {
        // Use the refactored loadEsbuild function with node_modules paths
        const nodeModulesPaths = [
            path.join(examplesDir, "node_modules"),
            path.join(rootDir, "node_modules"),
        ];
        esbuildInstance = loadEsbuild(nodeModulesPaths);

        if (!esbuildInstance) {
            throw new Error("esbuild not found in examples/node_modules or root node_modules");
        }
    });

    it("loads esbuild from node_modules", () => {
        expect(esbuildInstance).toBeTruthy();
        expect(esbuildInstance.build).toBeDefined();
    });

    it("bundles markdown with user code using BundlePipeline", async () => {
        const markdown = `
\`\`\`tsx
export const MyComponent = () => <div>Hello</div>;
\`\`\`
`;

        const pipeline = new BundlePipeline();
        const notePath = "Test.md";
        const absoluteNotePath = path.join(examplesDir, notePath);
        const resolutionContext = new ResolutionContext(examplesDir, absoluteNotePath);

        const result = await pipeline.process({
            markdown,
            notePath,
            absoluteNotePath,
            resolutionContext,
            esbuildInstance,
        });

        // Verify bundle succeeded
        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();
        expect(result.bundleCode).toContain("RemotionBundle");
    });

    it("executes bundle in jsdom iframe after bundling in node", async () => {
        const markdown = `
\`\`\`tsx
export const MyComponent = () => <div>Hello from Bundle</div>;
\`\`\`
`;

        // Step 1: Bundle in Node environment
        const pipeline = new BundlePipeline();
        const notePath = "Test.md";
        const absoluteNotePath = path.join(examplesDir, notePath);
        const resolutionContext = new ResolutionContext(examplesDir, absoluteNotePath);

        const result = await pipeline.process({
            markdown,
            notePath,
            absoluteNotePath,
            resolutionContext,
            esbuildInstance,
        });

        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        // Step 2: Execute bundle in JSDOM manually
        const { window, container } = createJsdomWindow();

        // Create a script element and execute the bundle
        const script = window.document.createElement("script");
        script.textContent = result.bundleCode;
        window.document.body.appendChild(script);

        // Verify that RemotionBundle was created
        expect((window as any).RemotionBundle).toBeDefined();
        expect((window as any).RemotionBundle.MyComponent).toBeDefined();
    });

    it("resolves React and remotion dependencies correctly", async () => {
        // Create markdown that imports React and remotion
        const markdown = `
\`\`\`tsx
import React from "react";
import { useCurrentFrame } from "remotion";

export const TestComponent = () => {
  const frame = useCurrentFrame();
  return React.createElement('div', null, 'Frame: ' + frame);
};
\`\`\`
`;

        // Step 1: Bundle in Node environment
        const pipeline = new BundlePipeline();
        const notePath = "Test.md";
        const absoluteNotePath = path.join(examplesDir, notePath);
        const resolutionContext = new ResolutionContext(examplesDir, absoluteNotePath);

        const result = await pipeline.process({
            markdown,
            notePath,
            absoluteNotePath,
            resolutionContext,
            esbuildInstance,
        });

        // Verify bundle succeeded
        expect(result.bundleStatus.status).toBe("ok");
        expect(result.bundleCode).toBeTruthy();

        // Bundle should contain React and remotion code (bundled together)
        expect(result.bundleCode).toContain("RemotionBundle");

        // Step 2: Execute bundle in JSDOM manually
        const { window } = createJsdomWindow();

        // Create a script element and execute the bundle
        const script = window.document.createElement("script");
        script.textContent = result.bundleCode;
        window.document.body.appendChild(script);

        // Verify that RemotionBundle was created with TestComponent
        expect((window as any).RemotionBundle).toBeDefined();
        expect((window as any).RemotionBundle.TestComponent).toBeDefined();

        // The component should be callable
        const component = (window as any).RemotionBundle.TestComponent;
        expect(typeof component).toBe("function");
    });
});
