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
        if (!activeView.file) {
            return null;
        }

        const startTime = performance.now();

        let blocks: ReturnType<typeof extractCodeBlocks>;
        let classified: ClassifiedBlock[];
        
        try {
            // Extract and classify code blocks - should be resilient to partial input
            blocks = extractCodeBlocks(activeView.editor.getValue());
            classified = classifyBlocks(blocks);
            
            // Only update cached blocks if we have valid content
            if (classified.length > 0) {
                this.lastExtractedBlocks = classified;
            }
        } catch (err) {
            console.error('[remotion] Failed to extract code blocks:', err);
            // Keep last known good state to avoid disrupting preview
            classified = this.lastExtractedBlocks;
            if (classified.length === 0) return null;
        }
        
        const notePath = activeView.file.path;
        let synthesized: ReturnType<typeof synthesizeVirtualModule>;
        
        try {
            synthesized = synthesizeVirtualModule(notePath, classified);
        } catch (err) {
            console.error('[remotion] Failed to synthesize module:', err);
            // Continue with empty synthesis to prevent breaking the preview
            return null;
        }
        
        const absoluteNotePath = path.join(this.vaultRoot, notePath);
        const virtualFileName = absoluteNotePath.replace(/\.md$/, '.tsx');
        const nodeModulesPaths = this.findNodeModulesPaths(path.dirname(absoluteNotePath), this.vaultRoot);
        
        // TypeScript compilation - wrapped in try-catch for resilience
        previewView.updateTypeCheckStatus('loading');
        const tsStart = performance.now();
        let compiled: ReturnType<typeof compileVirtualModule>;
        try {
            compiled = compileVirtualModule(virtualFileName, synthesized.code, nodeModulesPaths);
        } catch (err) {
            console.error('[remotion] TypeScript compilation failed:', err);
            previewView.updateTypeCheckStatus('error', 1);
            // Show error but keep previous render
            return null;
        }
        const tsEnd = performance.now();
        
        let markdownDiagnostics = mapDiagnosticsToMarkdown(
            compiled.diagnostics,
            synthesized.code,
            classified,
            synthesized.sceneExports
        );

        const errorCount = markdownDiagnostics.filter(d => d.category === 'error').length;
        previewView.updateTypeCheckStatus(errorCount > 0 ? 'error' : 'ok', errorCount);
        
        if (version !== this.updateVersion) return null;
        
        // Bundling - wrapped in try-catch for resilience
        previewView.updateBundleStatus('loading');
        const bundleStart = performance.now();
        let bundled: Awaited<ReturnType<typeof bundleVirtualModule>>;
        try {
            bundled = await bundleVirtualModule(
                compiled.code,
                virtualFileName,
                nodeModulesPaths,
                compiled.runtimeModules
            );
        } catch (err) {
            console.error('[remotion] Bundle failed:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            previewView.updateBundleStatus('error', errorMsg);
            // Return fallback result with error message
            bundled = { code: '/* Bundle failed - see console */', error: err as Error };
        }
        const bundleEnd = performance.now();
        
        if (version !== this.updateVersion) return null;

        // Add bundle errors to diagnostics, but don't prevent rendering
        if (bundled.error) {
            const bundleError = parseBundleError(bundled.error, classified);
            if (bundleError) {
                markdownDiagnostics = [...markdownDiagnostics, bundleError];
            }
        } else {
            previewView.updateBundleStatus('ok');
        }

        // Apply diagnostics to editor
        this.updateEditorDiagnostics(activeView, markdownDiagnostics);

        // Calculate preview locations with pixel offsets - handle missing data gracefully
        let previewLocations: CompilationResult['previewLocations'] = [];
        try {
            const editorEl = (activeView.editor as any).cm;
            const lineHeight = editorEl?.defaultLineHeight || 20;
            
            previewLocations = compiled.previewLocations.map(loc => ({
                line: loc.line,
                column: loc.column,
                topOffset: (loc.line - 1) * lineHeight,
                text: loc.text,
                options: loc.options,
            }));
        } catch (err) {
            console.warn('[remotion] Failed to calculate preview locations:', err);
        }

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
            bundleCode: bundled.code || '/* Bundle failed - see diagnostics */',
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
