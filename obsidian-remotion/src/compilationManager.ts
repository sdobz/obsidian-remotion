import { MarkdownView } from 'obsidian';
import { extractCodeBlocks, classifyBlocks, synthesizeVirtualModule, compileVirtualModule, mapDiagnosticsToMarkdown, parseBundleError, type ClassifiedBlock } from 'remotion-md';
import { bundleVirtualModule } from './bundler';
import { applyEditorDiagnostics, clearEditorDiagnostics } from './editorDiagnostics';
import type { PreviewView } from './previewView';
import path from 'path';

export interface CompilationResult {
    blocks: ClassifiedBlock[];
    previewLocations: Array<{
        line: number;
        column: number;
        topOffset: number;
        text: string;
        options?: Record<string, any>;
    }>;
    bundleCode: string;
    runtimeModules: Set<string>;
}

export class CompilationManager {
    private updateTimeoutId: number | null = null;
    private updateVersion = 0;
    private lastExtractedBlocks: ClassifiedBlock[] = [];

    constructor(
        private vaultRoot: string,
        private findNodeModulesPaths: (startDir: string, rootDir: string) => string[]
    ) {}

    scheduleUpdate(callback: () => Promise<void>, delay = 300): void {
        if (this.updateTimeoutId !== null) {
            window.clearTimeout(this.updateTimeoutId);
        }

        this.updateTimeoutId = window.setTimeout(() => {
            this.updateTimeoutId = null;
            this.updateVersion += 1;
            void callback();
        }, delay);
    }

    async compile(
        activeView: MarkdownView,
        previewView: PreviewView,
        version: number
    ): Promise<CompilationResult | null> {
        if (!activeView.file) return null;

        const startTime = performance.now();
        
        // Extract and classify code blocks
        const blocks = extractCodeBlocks(activeView.editor.getValue());
        const classified = classifyBlocks(blocks);
        this.lastExtractedBlocks = classified;
        
        const notePath = activeView.file.path;
        const synthesized = synthesizeVirtualModule(notePath, classified);
        
        const absoluteNotePath = path.join(this.vaultRoot, notePath);
        const virtualFileName = absoluteNotePath.replace(/\.md$/, '.tsx');
        const nodeModulesPaths = this.findNodeModulesPaths(path.dirname(absoluteNotePath), this.vaultRoot);
        
        // TypeScript compilation
        const tsStart = performance.now();
        const compiled = compileVirtualModule(virtualFileName, synthesized.code, nodeModulesPaths);
        const tsEnd = performance.now();
        
        let markdownDiagnostics = mapDiagnosticsToMarkdown(
            compiled.diagnostics,
            synthesized.code,
            classified,
            synthesized.sceneExports
        );
        
        if (version !== this.updateVersion) return null;
        
        // Bundling
        const bundleStart = performance.now();
        const bundled = await bundleVirtualModule(
            compiled.code,
            virtualFileName,
            nodeModulesPaths,
            compiled.runtimeModules
        );
        const bundleEnd = performance.now();
        
        if (version !== this.updateVersion) return null;

        // Add bundle errors to diagnostics
        if (bundled.error) {
            const bundleError = parseBundleError(bundled.error, classified);
            if (bundleError) {
                markdownDiagnostics = [...markdownDiagnostics, bundleError];
            }
        }

        // Apply diagnostics to editor
        this.updateEditorDiagnostics(activeView, markdownDiagnostics);

        // Calculate preview locations with pixel offsets
        const editorEl = (activeView.editor as any).cm;
        const lineHeight = editorEl?.defaultLineHeight || 20;
        
        const previewLocations = compiled.previewLocations.map(loc => ({
            line: loc.line,
            column: loc.column,
            topOffset: (loc.line - 1) * lineHeight,
            text: loc.text,
            options: loc.options,
        }));

        // Log performance metrics
        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const tsTime = tsEnd - tsStart;
        const bundleTime = bundleEnd - bundleStart;
        const reloadTime = endTime - bundleEnd;
        
        console.log(`[remotion] TypeScript: ${tsTime.toFixed(1)}ms | Bundle: ${bundleTime.toFixed(1)}ms | Reload: ${reloadTime.toFixed(1)}ms | Total: ${totalTime.toFixed(1)}ms`);

        return {
            blocks: classified,
            previewLocations,
            bundleCode: bundled.code || '/* no output */',
            runtimeModules: compiled.runtimeModules,
        };
    }

    private updateEditorDiagnostics(
        activeView: MarkdownView,
        diagnostics: ReturnType<typeof mapDiagnosticsToMarkdown>
    ): void {
        const cm = (activeView.editor as any).cm;
        if (!cm || typeof cm.dispatch !== 'function') return;

        if (diagnostics.length === 0) {
            clearEditorDiagnostics(cm);
            return;
        }

        applyEditorDiagnostics(cm, diagnostics);
    }

    clearDiagnostics(activeView: MarkdownView | null): void {
        if (!activeView) return;
        const cm = (activeView.editor as any).cm;
        if (!cm || typeof cm.dispatch !== 'function') return;
        clearEditorDiagnostics(cm);
    }

    getLastExtractedBlocks(): ClassifiedBlock[] {
        return this.lastExtractedBlocks;
    }

    getCurrentVersion(): number {
        return this.updateVersion;
    }
}
