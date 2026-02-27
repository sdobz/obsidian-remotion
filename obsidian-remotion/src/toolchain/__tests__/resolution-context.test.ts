/**
 * Unit tests for ResolutionContext
 *
 * Tests that module resolution paths are calculated consistently
 * and that context creation handles various directory structures.
 */
import { ResolutionContext } from "../resolution-context";
import fs from "fs";
import os from "os";
import path from "path";

describe("ResolutionContext", () => {
    describe("constructor", () => {
        it("should create context for vault root", () => {
            const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
            fs.mkdirSync(path.join(vaultRoot, "node_modules"), { recursive: true });
            const context = ResolutionContext.forVaultRoot(vaultRoot);

            expect(context.vaultRoot).toBe(vaultRoot);
            expect(context.nodeModulesPaths.length).toBeGreaterThan(0);
        });

        it("should include vaultRoot node_modules in search paths", () => {
            const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
            fs.mkdirSync(path.join(vaultRoot, "node_modules"), { recursive: true });
            const sourceFile = path.join(vaultRoot, "docs", "Example.md.tsx");
            const context = new ResolutionContext(vaultRoot, sourceFile);

            const vaultNodeModulesPath = path.join(vaultRoot, "node_modules");
            expect(context.nodeModulesPaths).toContain(vaultNodeModulesPath);
        });

        it("should set consistent resolutionDirectory for same source", () => {
            const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
            fs.mkdirSync(path.join(vaultRoot, "node_modules"), { recursive: true });
            const sourceFile = path.join(vaultRoot, "docs", "Example.md.tsx");
            const context = new ResolutionContext(vaultRoot, sourceFile);

            expect(context.resolutionDirectory).toBeTruthy();
            expect(context.resolutionDirectory).toBe(vaultRoot);
            expect(context.isValid()).toBe(true);
        });
    });

    describe("consistency across contexts", () => {
        it("should produce identical nodeModulesPaths for same source file", () => {
            const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
            fs.mkdirSync(path.join(vaultRoot, "node_modules"), { recursive: true });
            const sourceFile = path.join(vaultRoot, "docs", "Example.md.tsx");

            const context1 = new ResolutionContext(vaultRoot, sourceFile);
            const context2 = new ResolutionContext(vaultRoot, sourceFile);

            expect(context1.nodeModulesPaths).toEqual(context2.nodeModulesPaths);
            expect(context1.resolutionDirectory).toBe(context2.resolutionDirectory);
        });

        it("should handle deeply nested files", () => {
            const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
            fs.mkdirSync(path.join(vaultRoot, "node_modules"), { recursive: true });
            const deepSourceFile = path.join(
                vaultRoot,
                "docs",
                "a",
                "b",
                "c",
                "Example.md.tsx",
            );

            const context = new ResolutionContext(vaultRoot, deepSourceFile);

            expect(context.nodeModulesPaths.length).toBeGreaterThan(0);
            expect(context.resolutionDirectory).toBe(vaultRoot);
            expect(context.isValid()).toBe(true);
        });
    });
});
