/**
 * Unit tests for BundleCache
 *
 * Tests that caching correctly prevents redundant bundling and that
 * content-hash based caching handles module list reordering.
 */
import { BundleCache } from "../bundle-cache";

describe("BundleCache", () => {
  let cache: BundleCache;

  beforeEach(() => {
    cache = new BundleCache();
  });

  describe("content hashing", () => {
    it("should produce consistent hashes for same content", () => {
      const content = "import React from 'react';";
      const hash1 = BundleCache.computeHash(content);
      const hash2 = BundleCache.computeHash(content);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different content", () => {
      const hash1 = BundleCache.computeHash("code1");
      const hash2 = BundleCache.computeHash("code2");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getDepsBundle", () => {
    it("should cache results and return cached value on second call", async () => {
      const moduleIds = ["react", "react-dom/client"];
      let callCount = 0;

      const computeFn = async () => {
        callCount++;
        return "/* bundled code */";
      };

      const result1 = await cache.getDepsBundle(moduleIds, computeFn);
      const result2 = await cache.getDepsBundle(moduleIds, computeFn);

      expect(result1).toBe(result2);
      expect(callCount).toBe(1); // Should only compute once
    });

    it("should handle reordered module lists (cache hit)", async () => {
      const modules1 = ["react", "react-dom/client"];
      const modules2 = ["react-dom/client", "react"]; // Reordered
      let callCount = 0;

      const computeFn = async () => {
        callCount++;
        return "/* bundled code */";
      };

      const result1 = await cache.getDepsBundle(modules1, computeFn);
      const result2 = await cache.getDepsBundle(modules2, computeFn);

      // Should be same code due to sorted canonicalization
      expect(result1).toBe(result2);
      expect(callCount).toBe(1); // Reordering shouldn't cause recompute
    });

    it("should compute separately for different module sets", async () => {
      const modules1 = ["react", "react-dom/client"];
      const modules2 = ["react", "react-dom/client", "@remotion/media"];
      let callCount = 0;

      const computeFn = async () => {
        callCount++;
        return `/* bundle ${callCount} */`;
      };

      const result1 = await cache.getDepsBundle(modules1, computeFn);
      const result2 = await cache.getDepsBundle(modules2, computeFn);

      expect(result1).not.toBe(result2);
      expect(callCount).toBe(2);
    });
  });

  describe("getUserCodeBundle", () => {
    it("should cache user code bundles by content", async () => {
      const code = "export const Comp = () => null;";
      let callCount = 0;

      const computeFn = async () => {
        callCount++;
        return "/* bundled */";
      };

      const result1 = await cache.getUserCodeBundle(code, computeFn);
      const result2 = await cache.getUserCodeBundle(code, computeFn);

      expect(result1).toBe(result2);
      expect(callCount).toBe(1);
    });

    it("should compute separately for different code", async () => {
      let callCount = 0;

      const computeFn = async () => {
        callCount++;
        return `/* bundle ${callCount} */`;
      };

      const result1 = await cache.getUserCodeBundle("code1", computeFn);
      const result2 = await cache.getUserCodeBundle("code2", computeFn);

      expect(result1).not.toBe(result2);
      expect(callCount).toBe(2);
    });
  });

  describe("clear", () => {
    it("should clear both caches", async () => {
      const modules = ["react"];
      const code = "export default null;";
      let depsCallCount = 0;
      let userCallCount = 0;

      const depsCompute = async () => {
        depsCallCount++;
        return "/* deps */";
      };

      const userCompute = async () => {
        userCallCount++;
        return "/* user */";
      };

      await cache.getDepsBundle(modules, depsCompute);
      await cache.getUserCodeBundle(code, userCompute);

      cache.clear();

      await cache.getDepsBundle(modules, depsCompute);
      await cache.getUserCodeBundle(code, userCompute);

      // Each should have been called twice (once before clear, once after)
      expect(depsCallCount).toBe(2);
      expect(userCallCount).toBe(2);
    });
  });

  describe("getStats", () => {
    it("should report cache statistics", async () => {
      const modules = ["react"];
      const code = "export default null;";

      await cache.getDepsBundle(modules, async () => "/* 100 bytes */");
      await cache.getUserCodeBundle(code, async () => "/* 50 bytes */");

      const stats = cache.getStats();

      expect(stats.depsEntries).toBe(1);
      expect(stats.userCodeEntries).toBe(1);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });
});
