import { extractCodeBlocks, classifyBlocks } from './extraction';
import { synthesizeVirtualModule } from './synthesis';

describe('Virtual Module Synthesis', () => {
    test('synthesizes module with preview initialization', () => {
        const markdown = `
\`\`\`tsx
import { Composition } from 'remotion';
\`\`\`

\`\`\`tsx
preview(<Composition id="scene" component={Frame} durationInFrames={30} fps={30} width={1920} height={1080} />);
\`\`\`
`;

        const blocks = classifyBlocks(extractCodeBlocks(markdown));
        const result = synthesizeVirtualModule('Note.md', blocks);

        expect(result.code).toContain('globalThis.__previewComponents = []');
        expect(result.code).toContain('globalThis.__previewOptions = []');
        expect(result.code).toContain('import { Composition }');
        expect(result.code).toContain('preview(');
    });

    test('includes sentinels for all blocks', () => {
        const markdown = `
\`\`\`tsx
const A = 1;
\`\`\`

\`\`\`tsx
preview(<Scene />);
\`\`\`
`;

        const blocks = classifyBlocks(extractCodeBlocks(markdown));
        const result = synthesizeVirtualModule('MyNote.md', blocks);

        expect(result.code).toContain('// --- block 0 @ MyNote.md:2 ---');
        expect(result.code).toContain('// --- block 1 @ MyNote.md:6 ---');
    });

    test('concatenates all blocks without wrapping', () => {
        const markdown = `
\`\`\`tsx
preview(<SceneA />);
\`\`\`

\`\`\`tsx
preview(<SceneB />);
\`\`\`
`;

        const blocks = classifyBlocks(extractCodeBlocks(markdown));
        const result = synthesizeVirtualModule('Seq.md', blocks);

        expect(result.code).toContain('preview(<SceneA />');
        expect(result.code).toContain('preview(<SceneB />');
        expect(result.sceneExports).toHaveLength(0); // No scene exports, uses preview() pattern
    });
});
