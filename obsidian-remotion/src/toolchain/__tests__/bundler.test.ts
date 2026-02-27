/**
 * Unit tests for bundler plugin factories
 *
 * Tests that each plugin can be instantiated correctly.
 * Integration testing with real esbuild should be done in compilation.test.ts
 */
import { PluginFactories } from "../bundler";

describe("PluginFactories", () => {
  describe("createVirtualEntryPlugin", () => {
    it("should create plugin with correct name", () => {
      const entryCode = "export default () => null;";
      const entryName = "/path/to/Example.md.tsx";
      const plugin = PluginFactories.createVirtualEntryPlugin(
        entryCode,
        entryName,
      );

      expect(plugin.name).toBe("virtual-entry");
    });

    it("should have setup function", () => {
      const entryCode = "export default () => null;";
      const entryName = "/path/to/Example.md.tsx";
      const plugin = PluginFactories.createVirtualEntryPlugin(
        entryCode,
        entryName,
      );

      expect(typeof plugin.setup).toBe("function");
    });
  });

  describe("createMultiPathResolvePlugin", () => {
    it("should create plugin with correct name", () => {
      const plugin = PluginFactories.createMultiPathResolvePlugin([
        "/node_modules",
      ]);

      expect(plugin.name).toBe("multi-path-resolve");
    });

    it("should have setup function", () => {
      const plugin = PluginFactories.createMultiPathResolvePlugin([
        "/node_modules",
      ]);

      expect(typeof plugin.setup).toBe("function");
    });
  });

  describe("createExternalizePackagesPlugin", () => {
    it("should create plugin with correct name", () => {
      const plugin = PluginFactories.createExternalizePackagesPlugin();

      expect(plugin.name).toBe("externalize-packages");
    });

    it("should have setup function", () => {
      const plugin = PluginFactories.createExternalizePackagesPlugin();

      expect(typeof plugin.setup).toBe("function");
    });
  });

  describe("createTsResolvePlugin", () => {
    it("should create plugin with correct name", () => {
      const plugin = PluginFactories.createTsResolvePlugin(
        [],
        "/path/to/file.tsx",
        () => undefined,
      );

      expect(plugin.name).toBe("ts-resolve");
    });

    it("should have setup function", () => {
      const plugin = PluginFactories.createTsResolvePlugin(
        [],
        "/path/to/file.tsx",
        () => undefined,
      );

      expect(typeof plugin.setup).toBe("function");
    });
  });
});

