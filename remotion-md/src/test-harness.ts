/**
 * Test Harness for Integration Testing
 *
 * Provides a pure, testable environment that simulates the full compilation
 * and bundling flow without requiring Obsidian. This allows both unit tests
 * and Obsidian to use the same code paths.
 *
 * Architecture:
 * - Uses real file system (temp directories)
 * - Uses real esbuild for bundling
 * - Uses real TypeScript compiler
 * - No mocking - tests actual execution paths
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { extractCodeBlocks, classifyBlocks } from "./extraction";
import { synthesizeVirtualModule } from "./synthesis";
import { compileVirtualModule } from "./compiler";
import { findNodeModulesPaths, getResolutionDirectory } from "./resolution";

export interface TestVault {
    root: string;
    mkfile(filePath: string, content: string): void;
    mkdir(dirPath: string): void;
    readfile(filePath: string): string;
    exists(filePath: string): boolean;
    cleanup(): void;
}

export interface CompilationPipelineResult {
    /** Compiled JavaScript code */
    code: string;
    /** TypeScript diagnostics */
    diagnostics: readonly import("typescript").Diagnostic[];
    /** Locations of render() calls in markdown */
    widgetSpans: Array<{ line: number; column: number }>;
    /** Synthesized source code */
    synthesizedSource: string;
}

/**
 * Pure compilation pipeline: Markdown → Compiled JavaScript
 *
 * This function has no dependencies on Obsidian and can be tested
 * independently. It performs the complete transformation from markdown
 * to compiled JavaScript.
 *
 * @param markdownPath Absolute path to markdown file (e.g., /vault/Note.md)
 * @param markdownContent Content of the markdown file
 * @param vaultRoot Absolute path to vault root directory
 * @returns Compilation result with code, diagnostics, and dependencies
 */
export function compilationPipeline(
    markdownPath: string,
    markdownContent: string,
    vaultRoot: string,
): CompilationPipelineResult {
    // Step 1: Extract code blocks from markdown
    const blocks = extractCodeBlocks(markdownContent);
    const classified = classifyBlocks(blocks);

    // Step 2: Synthesize virtual TypeScript module
    const synthesized = synthesizeVirtualModule(path.basename(markdownPath), classified);

    // Step 3: Set up resolution paths
    const sourceDir = path.dirname(markdownPath);
    const nodeModulesPaths = findNodeModulesPaths(vaultRoot, sourceDir);
    const resolutionDir = getResolutionDirectory(nodeModulesPaths);

    // Step 4: Compile TypeScript to JavaScript
    const virtualFileName = markdownPath + ".tsx";
    const compiled = compileVirtualModule(
        virtualFileName,
        synthesized.code,
        nodeModulesPaths,
    );

    return {
        code: compiled.code,
        diagnostics: compiled.diagnostics,
        widgetSpans: compiled.widgetSpans,
        synthesizedSource: synthesized.code,
    };
}

/**
 * Create a temporary test vault
 *
 * Provides a real file system environment for testing without
 * requiring Obsidian or mocking.
 */
export function createTestVault(): TestVault {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-vault-"));

    return {
        root,

        mkfile(filePath: string, content: string): void {
            const fullPath = path.join(root, filePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, "utf-8");
        },

        mkdir(dirPath: string): void {
            const fullPath = path.join(root, dirPath);
            fs.mkdirSync(fullPath, { recursive: true });
        },

        readfile(filePath: string): string {
            const fullPath = path.join(root, filePath);
            return fs.readFileSync(fullPath, "utf-8");
        },

        exists(filePath: string): boolean {
            const fullPath = path.join(root, filePath);
            return fs.existsSync(fullPath);
        },

        cleanup(): void {
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    };
}

/**
 * Test Harness for Integration Testing
 *
 * Provides methods to test the complete flow from markdown to executable code.
 * Uses real implementations without mocking.
 */
export class TestHarness {
    vault: TestVault;

    constructor() {
        this.vault = createTestVault();
    }

    /**
     * Compile markdown content and return results
     *
     * @param markdownContent Markdown content with TypeScript code blocks
     * @param filename Optional filename (defaults to Test.md)
     */
    compile(
        markdownContent: string,
        filename: string = "Test.md",
    ): CompilationPipelineResult {
        // Create the file in vault
        this.vault.mkfile(filename, markdownContent);

        // Run compilation pipeline
        const fullPath = path.join(this.vault.root, filename);
        return compilationPipeline(fullPath, markdownContent, this.vault.root);
    }

    /**
     * Create a file in the test vault
     */
    createFile(filePath: string, content: string): void {
        this.vault.mkfile(filePath, content);
    }

    /**
     * Create a directory in the test vault
     */
    createDir(dirPath: string): void {
        this.vault.mkdir(dirPath);
    }

    /**
     * Install a mock npm package (for testing resolution)
     */
    installMockPackage(packageName: string, exports: Record<string, any>): void {
        const pkgDir = path.join("node_modules", packageName);
        this.vault.mkdir(pkgDir);

        // Create package.json
        this.vault.mkfile(
            path.join(pkgDir, "package.json"),
            JSON.stringify(
                {
                    name: packageName,
                    version: "1.0.0-test",
                    main: "index.js",
                },
                null,
                2,
            ),
        );

        // Create index.js with exports
        const exportsCode = Object.entries(exports)
            .map(([key, value]) => `exports.${key} = ${JSON.stringify(value)};`)
            .join("\n");
        this.vault.mkfile(path.join(pkgDir, "index.js"), exportsCode);
    }

    /**
     * Install stubbed dependencies for React and Remotion
     * This allows tests to run without needing actual npm packages
     */
    installStubbedDependencies(): void {
        // Install React stub
        this.vault.mkdir("node_modules/react");
        this.vault.mkfile(
            "node_modules/react/package.json",
            JSON.stringify({
                name: "react",
                version: "18.0.0-stub",
                main: "index.js",
                types: "index.d.ts",
                exports: {
                    ".": "./index.js",
                    "./jsx-runtime": "./jsx-runtime.js"
                }
            }),
        );
        this.vault.mkfile(
            "node_modules/react/index.js",
            `
exports.createElement = function() {};
exports.Component = class Component {};
exports.useState = function() { return [null, function(){}]; };
exports.useEffect = function() {};
exports.useMemo = function(fn) { return fn(); };
exports.useCallback = function(fn) { return fn; };
exports.useRef = function() { return { current: null }; };
`,
        );

        // Install React type definitions
        this.vault.mkfile(
            "node_modules/react/index.d.ts",
            `
declare namespace React {
  export interface ReactElement<P = any> {
    type: any;
    props: P;
  }
  export class Component<P = {}, S = {}> {}
  export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  export function useState<T>(initial: T): [T, (v: T) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useCallback<T extends Function>(fn: T, deps: any[]): T;
  export function useRef<T>(initial: T): { current: T };
}
export = React;
export as namespace React;

declare global {
  namespace JSX {
    interface Element extends React.ReactElement<any, any> {}
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
`,
        );

        // Install react/jsx-runtime stub
        this.vault.mkfile(
            "node_modules/react/jsx-runtime.js",
            `
exports.jsx = function() {};
exports.jsxs = function() {};
exports.Fragment = function() {};
`,
        );
        this.vault.mkfile(
            "node_modules/react/jsx-runtime.d.ts",
            `
export namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
export function jsx(type: any, props: any, key?: any): JSX.Element;
export function jsxs(type: any, props: any, key?: any): JSX.Element;
export const Fragment: any;
`,
        );

        // Install @remotion/player stub
        this.vault.mkdir("node_modules/@remotion");
        this.vault.mkdir("node_modules/@remotion/player");
        this.vault.mkfile(
            "node_modules/@remotion/player/package.json",
            JSON.stringify({
                name: "@remotion/player",
                version: "4.0.0-stub",
                main: "index.js",
                types: "index.d.ts",
            }),
        );
        this.vault.mkfile(
            "node_modules/@remotion/player/index.js",
            `
exports.Player = class Player {};
`,
        );
        this.vault.mkfile(
            "node_modules/@remotion/player/index.d.ts",
            `
import * as React from 'react';
export interface PlayerProps {
  component: React.ComponentType<any>;
  durationInFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
  [key: string]: any;
}
export class Player extends React.Component<PlayerProps> {}
`,
        );

        // Install remotion stub
        this.vault.mkdir("node_modules/remotion");
        this.vault.mkfile(
            "node_modules/remotion/package.json",
            JSON.stringify({
                name: "remotion",
                version: "4.0.0-stub",
                main: "index.js",
                types: "index.d.ts",
            }),
        );
        this.vault.mkfile(
            "node_modules/remotion/index.js",
            `
exports.Composition = function() {};
exports.Sequence = function() {};
exports.useCurrentFrame = function() { return 0; };
exports.useVideoConfig = function() { return { fps: 30, width: 1920, height: 1080, durationInFrames: 30 }; };
exports.AbsoluteFill = function() {};
exports.continueRender = function() {};
exports.delayRender = function() { return 'handle'; };
exports.interpolate = function(frame, range, output) { return output[0]; };
exports.spring = function() { return 0; };
`,
        );
        this.vault.mkfile(
            "node_modules/remotion/index.d.ts",
            `
import * as React from 'react';
export interface CompositionProps {
  id: string;
  component: React.ComponentType<any>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  [key: string]: any;
}
export const Composition: React.FC<CompositionProps>;
export const Sequence: React.FC<any>;
export function useCurrentFrame(): number;
export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}
export function useVideoConfig(): VideoConfig;
export const AbsoluteFill: React.FC<any>;
export function continueRender(handle: any): void;
export function delayRender(): any;
export function interpolate(frame: number, range: number[], output: number[]): number;
export function spring(options: any): number;
`,
        );

        // Install @remotion/bundler stub (if needed)
        this.vault.mkdir("node_modules/@remotion/bundler");
        this.vault.mkfile(
            "node_modules/@remotion/bundler/package.json",
            JSON.stringify({
                name: "@remotion/bundler",
                version: "4.0.0-stub",
                main: "index.js",
                types: "index.d.ts",
            }),
        );
        this.vault.mkfile(
            "node_modules/@remotion/bundler/index.js",
            `
exports.bundle = function() {};
`,
        );
        this.vault.mkfile(
            "node_modules/@remotion/bundler/index.d.ts",
            `
export function bundle(options: any): Promise<any>;
`,
        );

        // Install @remotion/core stub (commonly used)
        this.vault.mkdir("node_modules/@remotion/core");
        this.vault.mkfile(
            "node_modules/@remotion/core/package.json",
            JSON.stringify({
                name: "@remotion/core",
                version: "4.0.0-stub",
                main: "index.js",
                types: "index.d.ts",
            }),
        );
        this.vault.mkfile(
            "node_modules/@remotion/core/index.js",
            `
exports.Composition = function() {};
exports.useCurrentFrame = function() { return 0; };
exports.useVideoConfig = function() { return { fps: 30, width: 1920, height: 1080, durationInFrames: 30 }; };
`,
        );
        this.vault.mkfile(
            "node_modules/@remotion/core/index.d.ts",
            `
import * as React from 'react';
export interface CompositionProps {
  id: string;
  component: React.ComponentType<any>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  [key: string]: any;
}
export const Composition: React.FC<CompositionProps>;
export function useCurrentFrame(): number;
export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}
export function useVideoConfig(): VideoConfig;
`,
        );

        // Install remotion-md stub (for render() function)
        this.vault.mkdir("node_modules/remotion-md");
        this.vault.mkfile(
            "node_modules/remotion-md/package.json",
            JSON.stringify({
                name: "remotion-md",
                version: "0.1.0-stub",
                main: "index.js",
                types: "index.d.ts",
            }),
        );
        this.vault.mkfile(
            "node_modules/remotion-md/index.js",
            `
exports.render = function(component, options) {};
`,
        );
        this.vault.mkfile(
            "node_modules/remotion-md/index.d.ts",
            `
import * as React from 'react';
export function render(component: React.ReactElement, options: any): void;
`,
        );
    }

    /**
     * Cleanup test vault
     */
    cleanup(): void {
        this.vault.cleanup();
    }
}
