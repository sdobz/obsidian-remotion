import { bundleDependenciesBundle, loadEsbuild } from "../bundler";
import { ResolutionContext } from "../resolution-context";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * Test: bundleDependencies properly extracts module exports
 *
 * When bundling a list of module IDs, the result should:
 * 1. Generate code without errors
 * 2. Execute and populate __REMOTION_DEPS_BUNDLE__
 * 3. Have m0, m1, etc. properties accessible via the bundle
 */
describe("bundleDependenciesBundle module extraction", () => {
  it("should generate bundled code with proper module exports", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-extract-"));

    try {
      const resolutionContext = new ResolutionContext(tmpDir, tmpDir);
      const esbuild = loadEsbuild(resolutionContext);
      if (!esbuild) {
        throw new Error("esbuild not available");
      }

      // Bundle react which should be available
      const moduleIds = ["react"];
      const bundleResult = await bundleDependenciesBundle(
        moduleIds,
        esbuild,
        resolutionContext,
      );

      // Should succeed
      expect(bundleResult.error).toBeUndefined();
      expect(bundleResult.code).toBeTruthy();
      expect(bundleResult.code.length).toBeGreaterThan(100);

      console.log("=== Bundled Code Length ===", bundleResult.code.length);
      console.log(
        "=== First 400 chars ===",
        bundleResult.code.substring(0, 400),
      );

      // Should contain the __REMOTION_DEPS_BUNDLE__ global
      expect(bundleResult.code).toContain("__REMOTION_DEPS_BUNDLE__");

      // Execute the code and verify module exports are accessible
      const globalObj = {} as Record<string, any>;
      const executeInScope = `
        var __REMOTION_DEPS_BUNDLE__;
        ${bundleResult.code}
        this.__REMOTION_DEPS_BUNDLE__ = __REMOTION_DEPS_BUNDLE__;
      `;

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(executeInScope).call(globalObj);

      const bundledDeps = globalObj.__REMOTION_DEPS_BUNDLE__;
      expect(bundledDeps).toBeDefined();
      console.log("=== Bundle exports keys ===", Object.keys(bundledDeps));

      // Should have m0 for react
      expect(bundledDeps.m0).toBeDefined();

      // m0 should be react
      expect(typeof bundledDeps.m0).toBe("object");
      expect(bundledDeps.m0.useState || bundledDeps.m0.Fragment).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
