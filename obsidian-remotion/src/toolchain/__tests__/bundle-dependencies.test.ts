import { bundleDependenciesBundle, loadEsbuild } from "../bundler";
import { ResolutionContext } from "../resolution-context";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * Test: bundleDependenciesBundle correctly handles real npm dependencies
 *
 * When given a list of module IDs to bundle, the result should:
 * 1. Successfully bundle without errors
 * 2. Create code that can be executed
 * 3. Expose bundled modules via the global __REMOTION_DEPS_BUNDLE__ object
 */
describe("bundleDependenciesBundle", () => {
  it("should bundle react and make it available at runtime", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-deps-test-"));

    try {
      // Set up resolution context
      const resolutionContext = new ResolutionContext(tmpDir, tmpDir);

      // Load esbuild
      const esbuild = loadEsbuild(resolutionContext);
      if (!esbuild) {
        throw new Error("esbuild not available");
      }

      // Bundle react as a dependency
      const bundleResult = await bundleDependenciesBundle(
        ["react"],
        esbuild,
        resolutionContext,
      );

      // Should succeed without errors
      expect(bundleResult.error).toBeUndefined();
      expect(bundleResult.code).toBeTruthy();
      expect(bundleResult.code.length).toBeGreaterThan(100);

      // Code should contain the __REMOTION_DEPS_BUNDLE__ global
      expect(bundleResult.code).toContain("__REMOTION_DEPS_BUNDLE__");

      // Execute the code in a way that captures the global
      // The code structure is: var __REMOTION_DEPS_BUNDLE__ = (() => { ... })();
      // We need to extract this value after executing
      const globalObj = {} as Record<string, any>;

      // Use a wrapper that executes in the global scope
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
      const executeInScope = `
        var __REMOTION_DEPS_BUNDLE__;
        ${bundleResult.code}
        this.__REMOTION_DEPS_BUNDLE__ = __REMOTION_DEPS_BUNDLE__;
      `;

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(executeInScope).call(globalObj);

      // After execution, the bundle should have exposed modules
      const bundledDeps = globalObj.__REMOTION_DEPS_BUNDLE__;
      expect(bundledDeps).toBeDefined();
      expect(typeof bundledDeps).toBe("object");
      expect(bundledDeps.m0).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
