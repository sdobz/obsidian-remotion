import { installRuntimeDeps } from "../runtime-deps";

describe("installRuntimeDeps", () => {
    it("installs require that resolves injected modules", () => {
        const iframeWindow: { require?: (id: string) => unknown } = {};
        const reactModule = { createElement: () => null };

        installRuntimeDeps(iframeWindow, { react: reactModule });

        expect(iframeWindow.require).toBeDefined();
        expect(iframeWindow.require?.("react")).toBe(reactModule);
    });

    it("throws when module is missing", () => {
        const iframeWindow: { require?: (id: string) => unknown } = {};

        installRuntimeDeps(iframeWindow, { react: {} });

        expect(() => iframeWindow.require?.("missing")).toThrow(
            "Module not found: missing. All modules must be pre-injected.",
        );
    });
});
