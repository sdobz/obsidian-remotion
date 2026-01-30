#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { extractCodeBlocks, classifyBlocks } from './extraction';
import { synthesizeVirtualModule } from './synthesis';
import { compileVirtualModule } from './compiler';
import { extractPreviewCallLocations, PreviewPlayerOptions } from './previewLocations';

interface RenderConfig {
    compositionId?: string;
    outputLocation?: string;
    width?: number;
    height?: number;
    fps?: number;
    durationInFrames?: number;
}

const PREVIEW_DEFAULTS: PreviewPlayerOptions = {
    durationInFrames: 150,
    fps: 30,
    compositionWidth: 1280,
    compositionHeight: 720,
    controls: true,
    loop: false,
    autoPlay: false,
};

function parseCliArgs(): { mdPath: string; config: RenderConfig; remotionArgs: string[] } {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`
remotion-md - Render Remotion videos from Markdown files

Usage:
  remotion-md <markdown-file> [options] [-- remotion-options]

Options:
  --composition <id>       Composition ID to render (default: first preview)
  --output <path>          Output file path (default: out.mp4)
  --width <pixels>         Video width (default: from preview options or 1280)
  --height <pixels>        Video height (default: from preview options or 720)
  --fps <number>           Frames per second (default: from preview options or 30)
  --duration <frames>      Duration in frames (default: from preview options or 150)

Any arguments after -- are passed directly to Remotion CLI

Examples:
  remotion-md video.md --output video.mp4
  remotion-md video.md --composition scene1 -- --concurrency=4
  remotion-md video.md --width 1920 --height 1080 --fps 60
        `);
        process.exit(0);
    }

    const mdPath = args[0];
    const config: RenderConfig = {};
    const remotionArgs: string[] = [];
    let inRemotionArgs = false;

    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--') {
            inRemotionArgs = true;
            continue;
        }

        if (inRemotionArgs) {
            remotionArgs.push(arg);
            continue;
        }

        switch (arg) {
            case '--composition':
                config.compositionId = args[++i];
                break;
            case '--output':
                config.outputLocation = args[++i];
                break;
            case '--width':
                config.width = parseInt(args[++i], 10);
                break;
            case '--height':
                config.height = parseInt(args[++i], 10);
                break;
            case '--fps':
                config.fps = parseInt(args[++i], 10);
                break;
            case '--duration':
                config.durationInFrames = parseInt(args[++i], 10);
                break;
            default:
                if (arg.startsWith('--')) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
        }
    }

    return { mdPath, config, remotionArgs };
}

function getPreviewConfig(previewLocations: ReturnType<typeof extractPreviewCallLocations>): PreviewPlayerOptions | null {
    // Default to last preview if no specific composition requested
    if (previewLocations.length === 0) return null;
    
    const lastPreview = previewLocations[previewLocations.length - 1];
    return lastPreview.options || null;
}

async function main() {
    const { mdPath, config, remotionArgs } = parseCliArgs();

    // Validate markdown file
    if (!fs.existsSync(mdPath)) {
        console.error(`Error: Markdown file not found: ${mdPath}`);
        process.exit(1);
    }

    const absoluteMdPath = path.resolve(mdPath);
    const mdContent = fs.readFileSync(absoluteMdPath, 'utf-8');

    console.log(`[remotion-md] Processing ${path.basename(mdPath)}...`);

    // Extract and classify blocks
    const blocks = extractCodeBlocks(mdContent);
    if (blocks.length === 0) {
        console.error(`Error: No TypeScript/TSX code blocks found in ${mdPath}`);
        console.error('Add code blocks with \`\`\`ts or \`\`\`tsx language tags.');
        process.exit(1);
    }

    const classified = classifyBlocks(blocks);
    console.log(`[remotion-md] Found ${classified.length} code block(s)`);

    // Check for preview() calls
    const hasPreview = classified.some(block => block.content.includes('preview('));
    if (!hasPreview) {
        console.error('Error: No preview() calls found in code blocks');
        console.error('Add preview() calls to mark components for rendering.');
        console.error('Example:');
        console.error('  ```tsx');
        console.error('  import { preview } from "remotion-md";');
        console.error('  preview(<MyVideo />, { durationInFrames: 150, fps: 30 });');
        console.error('  ```');
        process.exit(1);
    }

    // Synthesize virtual module
    const synthesized = synthesizeVirtualModule(path.basename(mdPath), classified);
    
    // Compile the synthesized module to extract preview locations
    const virtualFileName = absoluteMdPath.replace(/\.md$/, '.tsx');
    const nodeModulesPaths = [path.join(process.cwd(), 'node_modules')];
    
    console.log('[remotion-md] Compiling TypeScript...');
    const compiled = compileVirtualModule(virtualFileName, synthesized.code, nodeModulesPaths, { includeLib: true });

    if (compiled.diagnostics.length > 0) {
        console.error('\nTypeScript Errors:');
        compiled.diagnostics.forEach(diag => {
            const file = diag.file;
            const line = file && diag.start !== undefined
                ? file.getLineAndCharacterOfPosition(diag.start).line + 1
                : 0;
            const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
            console.error(`  Line ${line}: ${message}`);
        });
        console.error('\nFix these errors before rendering.');
        process.exit(1);
    }

    // Extract preview locations and get config from last preview
    const previewLocations = compiled.previewLocations;
    const previewConfig = getPreviewConfig(previewLocations);
    
    if (previewLocations.length === 0) {
        console.error('Error: No preview() calls found in compiled code');
        console.error('This should not happen if preview() calls were detected in source.');
        process.exit(1);
    }

    // Use last preview as default composition
    const defaultCompositionId = `preview-${previewLocations.length - 1}`;
    
    const finalConfig: Required<RenderConfig> = {
        compositionId: config.compositionId || defaultCompositionId,
        outputLocation: config.outputLocation || 'out.mp4',
        width: config.width || previewConfig?.compositionWidth || PREVIEW_DEFAULTS.compositionWidth!,
        height: config.height || previewConfig?.compositionHeight || PREVIEW_DEFAULTS.compositionHeight!,
        fps: config.fps || previewConfig?.fps || PREVIEW_DEFAULTS.fps!,
        durationInFrames: config.durationInFrames || previewConfig?.durationInFrames || PREVIEW_DEFAULTS.durationInFrames!,
    };

    // Write temporary composition file
    const tempDir = path.join(process.cwd(), '.remotion-md-temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = path.join(tempDir, 'composition.tsx');
    // Use relative path from cwd so Remotion finds config in project root
    const relativeTempFile = path.relative(process.cwd(), tempFile);
    
    // Generate a composition file that uses registerRoot
    const compositionCode = `
import { Composition, registerRoot } from 'remotion';
import * as React from 'react';

${compiled.code}

// Build composition from preview calls
const previewComponents = (globalThis as any).__previewComponents || [];
const previewOptions = (globalThis as any).__previewOptions || [];

if (previewComponents.length === 0) {
    throw new Error('No preview() calls found');
}

const RemotionRoot: React.FC = () => {
    return (
        <>
            {previewComponents.map((Component: any, i: number) => {
                const options = previewOptions[i] || {};
                return (
                    <Composition
                        key={\`preview-\${i}\`}
                        id={\`preview-\${i}\`}
                        component={Component}
                        durationInFrames={options.durationInFrames || ${finalConfig.durationInFrames}}
                        fps={options.fps || ${finalConfig.fps}}
                        width={options.compositionWidth || ${finalConfig.width}}
                        height={options.compositionHeight || ${finalConfig.height}}
                    />
                );
            })}
        </>
    );
};

registerRoot(RemotionRoot);
`;

    fs.writeFileSync(tempFile, compositionCode);
    console.log(`[remotion-md] Created temporary composition at ${tempFile}`);

    // Build remotion render command
    const remotionCmd = [
        'npx',
        'remotion',
        'render',
        relativeTempFile,
        finalConfig.compositionId,
        finalConfig.outputLocation,
        ...remotionArgs
    ];

    console.log(`\n[remotion-md] Rendering with Remotion...`);
    console.log(`  Composition: ${finalConfig.compositionId}`);
    console.log(`  Output: ${finalConfig.outputLocation}`);
    console.log(`  Size: ${finalConfig.width}x${finalConfig.height}`);
    console.log(`  FPS: ${finalConfig.fps}`);
    console.log(`  Duration: ${finalConfig.durationInFrames} frames\n`);

    // Execute remotion render from current directory
    // Remotion will use its own configuration (remotion.config.ts) if present in the project
    const { spawn } = require('child_process');
    const remotionProcess = spawn(remotionCmd[0], remotionCmd.slice(1), {
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    remotionProcess.on('close', (code: number) => {
        // Clean up temp file
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
            fs.rmdirSync(tempDir);
        }

        if (code === 0) {
            console.log(`\n[remotion-md] ✓ Render complete: ${finalConfig.outputLocation}`);
        } else {
            console.error(`\n[remotion-md] ✗ Render failed with code ${code}`);
            process.exit(code || 1);
        }
    });
}

main().catch(err => {
    console.error('Error:', err.message || err);
    process.exit(1);
});
