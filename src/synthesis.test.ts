import { extractCodeBlocks, classifyBlocks } from './extraction';
import { synthesizeVirtualModule } from './synthesis';

describe('Virtual Module Synthesis', () => {
    test('synthesizes module with wrapped scene exports', () => {
        const markdown = `
\`\`\`tsx
import { Composition } from 'remotion';
\`\`\`

\`\`\`tsx
<Composition id="scene" component={Frame} durationInFrames={30} fps={30} width={1920} height={1080} />
\`\`\`
`;

        const blocks = classifyBlocks(extractCodeBlocks(markdown));
        const result = synthesizeVirtualModule('Note.md', blocks);

        expect(result.code).toContain('import { Composition }');
        expect(result.code).toContain('export const __scene_1');
        expect(result.sceneExports[0].exportName).toBe('__scene_1');
        expect(result.code).toContain('export default __sequence;');
    });

    test('includes sentinels for module and scene blocks', () => {
        const markdown = `
\`\`\`tsx
const A = 1;
\`\`\`

\`\`\`tsx
<Scene />
\`\`\`
`;

        const blocks = classifyBlocks(extractCodeBlocks(markdown));
        const result = synthesizeVirtualModule('MyNote.md', blocks);

        expect(result.code).toContain('// --- block 0 @ MyNote.md:2 ---');
        expect(result.code).toContain('// --- block 1 @ MyNote.md:6 ---');
    });

    test('exports a sequence containing all scenes', () => {
        const markdown = `
\`\`\`tsx
<SceneA />
\`\`\`

\`\`\`tsx
<SceneB />
\`\`\`
`;

        const blocks = classifyBlocks(extractCodeBlocks(markdown));
        const result = synthesizeVirtualModule('Seq.md', blocks);

        expect(result.code).toContain('type Sequence');
        expect(result.code).toContain('const __sequence');
        expect(result.code).toContain('export default __sequence;');
        expect(result.sceneExports).toHaveLength(2);
    });
});
