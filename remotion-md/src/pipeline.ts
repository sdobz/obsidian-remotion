/**
 * Bundling Pipeline
 *
 * Orchestrates the bundling process: extract → synthesize → bundle
 * This is pure (no Obsidian dependencies) and can be used by any frontend.
 */

import type esbuild from "esbuild";
import {
    extractCodeBlocks,
    classifyBlocks,
    type ClassifiedBlock,
} from "./extraction";
import { synthesizeVirtualModule } from "./synthesis";
import {
    bundleTypeScriptSource,
    type BundleResult,
    type BundleContext,
} from "./bundler";
import type { ResolutionContext } from "./resolutionContext";

export interface BundlePipelineInput {
    markdown: string; // Raw markdown text
    notePath: string; // Path relative to vault root (e.g., "folder/note.md")
    absoluteNotePath: string; // Full path to markdown file
    resolutionContext: BundleContext | ResolutionContext;
    esbuildInstance: typeof esbuild;
}

export interface BundleOutput {
    bundleCode: string;
    synthesizedCode: string;
    classified: ClassifiedBlock[];
    bundleStatus: { status: "ok" | "error"; error?: string };
}

/**
 * BundlePipeline manages the full bundling process.
 * Used by obsidian-remotion to create bundles without tight coupling to bundling logic.
 */
export class BundlePipeline {
    private lastClassified: ClassifiedBlock[] = [];
    private lastSynthesized: string = "";

    /**
     * Process markdown and produce a bundle.
     * Extracts code blocks, synthesizes TSX, and calls esbuild.
     */
    async process(input: BundlePipelineInput): Promise<BundleOutput> {
        const { markdown, notePath, absoluteNotePath, resolutionContext, esbuildInstance } = input;

        // Step 1: Extract and classify
        let classified: ClassifiedBlock[];
        try {
            const blocks = extractCodeBlocks(markdown);
            classified = classifyBlocks(blocks);
            if (classified.length > 0) this.lastClassified = classified;
        } catch (err) {
            console.error("[remotion-md] Failed to extract code blocks:", err);
            classified = this.lastClassified;
            if (classified.length === 0) {
                return {
                    bundleCode: "/* No code blocks found */",
                    synthesizedCode: "",
                    classified: [],
                    bundleStatus: { status: "error", error: "No code blocks found" },
                };
            }
        }

        // Step 2: Synthesize
        let synthesized: ReturnType<typeof synthesizeVirtualModule>;
        try {
            synthesized = synthesizeVirtualModule(notePath, classified);
            this.lastSynthesized = synthesized.code;
        } catch (err) {
            console.error("[remotion-md] Failed to synthesize module:", err);
            return {
                bundleCode: "/* Synthesis failed */",
                synthesizedCode: this.lastSynthesized,
                classified,
                bundleStatus: { status: "error", error: String(err) },
            };
        }

        // Step 3: Bundle
        const virtualFileName = absoluteNotePath + ".tsx";
        let bundleResult: BundleResult;
        try {
            bundleResult = await bundleTypeScriptSource(
                synthesized.code,
                virtualFileName,
                esbuildInstance,
                resolutionContext,
                absoluteNotePath,
                markdown,
            );
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return {
                bundleCode: "/* Bundle failed */",
                synthesizedCode: synthesized.code,
                classified,
                bundleStatus: { status: "error", error: errorMsg },
            };
        }

        const bundleCode = bundleResult.code || "/* Bundle failed - see diagnostics */";
        const bundleError = bundleResult.error
            ? bundleResult.error instanceof Error
                ? bundleResult.error.message
                : String(bundleResult.error)
            : undefined;

        return {
            bundleCode,
            synthesizedCode: synthesized.code,
            classified,
            bundleStatus: {
                status: bundleError ? "error" : "ok",
                error: bundleError,
            },
        };
    }

    /**
     * Get cached last synthesized code (for sharing with typecheck).
     */
    getLastSynthesized(): string {
        return this.lastSynthesized;
    }

    /**
     * Get cached classified blocks (for sharing with typecheck).
     */
    getLastClassified(): ClassifiedBlock[] {
        return this.lastClassified;
    }

    /**
     * Reset cached state (e.g., when switching files).
     */
    reset(): void {
        this.lastClassified = [];
        this.lastSynthesized = "";
    }
}

/**
 * Factory for creating esbuild instance (formerly in bundler.ts).
 * Can be used by both bundling pipeline and other consumers.
 */
export function loadEsbuildInstance(): typeof esbuild {
    // This is already provided by remotion-md, re-export for convenience
    return require("esbuild");
}
