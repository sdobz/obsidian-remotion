import { bundleDependenciesBundle, loadEsbuild } from "../bundler";
import { ResolutionContext } from "../resolution-context";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * Test: bundleDependenciesBundle handles markdown imports in dependency chains
 *
 * When a module list includes packages that depend on markdown files,
 * the dependency bundler should resolve markdown imports via the loader.
 */
describe("bundleDependenciesBundle with markdown", () => {
  it("should handle markdown imports in dependency chains", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deps-test-"));

    try {
      // Create Player.md that exports a component
      const playerMdPath = path.join(tmpDir, "Player.md");
      fs.writeFileSync(
        playerMdPath,
        `
# Player

\`\`\`tsx
import React from "react";
export const Player = () => <div>Player</div>;
\`\`\`
`,
      );

      // Create index.tsx that imports Player.md and react
      const indexPath = path.join(tmpDir, "index.tsx");
      fs.writeFileSync(
        indexPath,
        `
import React from "react";
import { Player } from "./Player.md";
export { Player };
`,
      );

      // Set up resolution context
      const resolutionContext = new ResolutionContext(tmpDir, indexPath);

      // Load esbuild
      const esbuild = loadEsbuild(resolutionContext);
      if (!esbuild) {
        throw new Error("esbuild not available");
      }

      // Try to bundle with a module that depends on markdown
      // This simulates the real scenario: Basic.md -> Player.md -> react
      const bundleResult = await bundleDependenciesBundle(
        ["react"],
        esbuild,
        resolutionContext,
      );

      // Should succeed without resolution errors
      expect(bundleResult.error).toBeUndefined();
      expect(bundleResult.code).toBeTruthy();
      expect(bundleResult.code.length).toBeGreaterThan(100);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
