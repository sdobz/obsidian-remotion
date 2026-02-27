import { installRuntimeDeps } from "../runtime-deps";

/**
 * Test: Runtime dependency injection simulating preview.ts flow
 *
 * This test simulates what happens when:
 * 1. bundledDeps code is executed in iframe
 * 2. __REMOTION_DEPS_BUNDLE__ is populated
 * 3. Modules are extracted and installed via installRuntimeDeps
 */
describe("Preview injection flow", () => {
    it("should extract and inject dependencies from bundled code", () => {
        // Simulate the bundled dependencies code
        // This is similar to what bundleDependenciesBundle produces
        const bundledCode = `
      var __REMOTION_DEPS_BUNDLE__ = (() => {
        // Simplified mock of react module
        var react_module = {
          useState: function() { return [null, function(){}]; },
          Fragment: Symbol.for('react.fragment'),
          createElement: function(type, props, ...children) { return { type, props, children }; }
        };
        
        var stdin_exports = {};
        var m0 = react_module;
        stdin_exports.m0 = m0;
        return stdin_exports;
      })();
    `;

        // Create a mock iframe window
        const mockIframeWindow = {} as any;

        // Execute the bundled code in the mock iframe
        const executeInScope = `
      var __REMOTION_DEPS_BUNDLE__;
      ${bundledCode}
      this.__REMOTION_DEPS_BUNDLE__ = __REMOTION_DEPS_BUNDLE__;
    `;
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(executeInScope).call(mockIframeWindow);

        console.log("=== Bundled Deps in iframe ===", mockIframeWindow.__REMOTION_DEPS_BUNDLE__);

        // Now simulate what preview.ts does: extract modules and inject
        const moduleIds = ["react"];
        const bundleExports = mockIframeWindow.__REMOTION_DEPS_BUNDLE__;
        const deps: Record<string, unknown> = {};

        moduleIds.forEach((id, idx) => {
            const moduleExport = bundleExports?.[`m${idx}`];
            if (moduleExport !== undefined) {
                deps[id] = moduleExport;
                console.log(`Extracted module ${id} at index ${idx}`);
            } else {
                console.warn(
                    `[remotion] Module ${id} not found in bundle at index ${idx}. This may happen if the module failed to bundle.`,
                );
            }
        });

        // Now inject into the iframe window
        installRuntimeDeps(mockIframeWindow, deps);

        // Verify the require function works
        expect(typeof mockIframeWindow.require).toBe("function");
        const reactModule = mockIframeWindow.require("react");
        expect(reactModule).toBeDefined();
        expect(reactModule.useState).toBeDefined();
    });

    it("should handle missing modules gracefully", () => {
        // Simulate empty bundled code
        const bundledCode = `
      var __REMOTION_DEPS_BUNDLE__ = (() => {
        var stdin_exports = {};
        return stdin_exports;
      })();
    `;

        const mockIframeWindow = {} as any;

        const executeInScope = `
      var __REMOTION_DEPS_BUNDLE__;
      ${bundledCode}
      this.__REMOTION_DEPS_BUNDLE__ = __REMOTION_DEPS_BUNDLE__;
    `;
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(executeInScope).call(mockIframeWindow);

        // Try to inject dependencies
        const moduleIds = ["react"];
        const bundleExports = mockIframeWindow.__REMOTION_DEPS_BUNDLE__;
        const deps: Record<string, unknown> = {};

        moduleIds.forEach((id, idx) => {
            const moduleExport = bundleExports?.[`m${idx}`];
            if (moduleExport !== undefined) {
                deps[id] = moduleExport;
            } else {
                console.warn(
                    `[remotion] Module ${id} not found in bundle at index ${idx}. This may happen if the module failed to bundle.`,
                );
            }
        });

        installRuntimeDeps(mockIframeWindow, deps);

        // require should throw for missing module
        expect(() => mockIframeWindow.require("react")).toThrow(
            /Module not found: react/,
        );
    });
});
