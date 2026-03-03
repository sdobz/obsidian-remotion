import { describe, test, expect } from "vitest";
import ts from "typescript";
import { createLanguageService } from "../toolchain/ts";
import path from "path";

describe("language service happy path", () => {
  test("language service syntactic + semantic diagnostics are empty for a trivial file", () => {
    // Use a single self-contained file (no imports) to assert the basic happy path
    const virtualFiles = new Map<string, string>([
      ["/virtual/a.ts", "export const a = 1;"],
    ]);

    const documentVersions = new Map<string, number>();
    documentVersions.set("/virtual/a.ts", 1);

    // Provide actual node_modules path from examples directory
    const examplesNodeModules = path.resolve(__dirname, "../../../examples/node_modules");

    const { languageService } = createLanguageService(
      "/virtual/a.ts",
      [examplesNodeModules],
      virtualFiles,
      documentVersions,
      undefined,
    );

    const syntactic = languageService.getSyntacticDiagnostics("/virtual/a.ts");
    const semantic = languageService.getSemanticDiagnostics("/virtual/a.ts");

    expect(syntactic.length).toBe(0);
    expect(semantic.length).toBe(0);
  });

  // Edge cases: alias resolution, monorepo hoisting, caching across updates
  // will be tested in follow-up commits.
});
