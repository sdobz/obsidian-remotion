/**
 * BundleCache: Content-hash based caching for user code and dependencies
 *
 * Prevents rebundling when code hasn't changed. Uses content hash instead of
 * parameter comparison to handle reordering of module lists and other variations.
 */
import crypto from "crypto";

export interface CacheEntry {
  hash: string;
  bundledCode: string;
  timestamp: number;
}

export class BundleCache {
  private userCodeCache = new Map<string, CacheEntry>();
  private depsCache = new Map<string, CacheEntry>();

  /**
   * Compute SHA256 hash of input
   */
  static computeHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Get or set user code bundle (async compute function)
   */
  async getUserCodeBundle(
    sourceCode: string,
    computeFn: () => Promise<string>,
  ): Promise<string> {
    const hash = BundleCache.computeHash(sourceCode);
    const cached = this.userCodeCache.get(hash);
    if (cached) {
      return cached.bundledCode;
    }

    const bundledCode = await computeFn();
    this.userCodeCache.set(hash, {
      hash,
      bundledCode,
      timestamp: Date.now(),
    });
    return bundledCode;
  }

  /**
   * Get or set dependencies bundle (async compute function)
   */
  async getDepsBundle(
    moduleIds: string[],
    computeFn: () => Promise<string>,
  ): Promise<string> {
    // Use sorted module list for consistency (reordering won't break cache)
    const canonicalList = [...moduleIds].sort().join("|");
    const hash = BundleCache.computeHash(canonicalList);
    const cached = this.depsCache.get(hash);
    if (cached) {
      return cached.bundledCode;
    }

    const bundledCode = await computeFn();
    this.depsCache.set(hash, {
      hash,
      bundledCode,
      timestamp: Date.now(),
    });
    return bundledCode;
  }

  /**
   * Clear all caches (useful after vault configuration changes)
   */
  clear(): void {
    this.userCodeCache.clear();
    this.depsCache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats() {
    return {
      userCodeEntries: this.userCodeCache.size,
      depsEntries: this.depsCache.size,
      totalSize:
        Array.from(this.userCodeCache.values()).reduce(
          (sum, e) => sum + e.bundledCode.length,
          0,
        ) +
        Array.from(this.depsCache.values()).reduce(
          (sum, e) => sum + e.bundledCode.length,
          0,
        ),
    };
  }
}
