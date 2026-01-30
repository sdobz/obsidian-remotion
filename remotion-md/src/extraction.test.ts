import { extractCodeBlocks, classifyBlocks } from './extraction';

describe('Block Extraction', () => {
    test('extracts ts code blocks from markdown', () => {
        const markdown = `
# My Document

Some prose.

\`\`\`ts
import { spring } from "remotion";
\`\`\`

More text.

\`\`\`tsx
export const Scene = () => <div>Hello</div>;
\`\`\`

End.
`;

        const blocks = extractCodeBlocks(markdown);
        
        expect(blocks).toHaveLength(2);
        expect(blocks[0].language).toBe('ts');
        expect(blocks[0].content).toBe('import { spring } from "remotion";');
        expect(blocks[1].language).toBe('tsx');
        expect(blocks[1].content).toBe('export const Scene = () => <div>Hello</div>;');
    });

    test('ignores non-ts code blocks', () => {
        const markdown = `
\`\`\`javascript
console.log('hello');
\`\`\`

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`python
print('world')
\`\`\`
`;

        const blocks = extractCodeBlocks(markdown);
        
        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('ts');
    });

    test('handles multiple ts blocks in sequence', () => {
        const markdown = `
\`\`\`ts
const a = 1;
\`\`\`

\`\`\`ts
const b = 2;
\`\`\`

\`\`\`ts
const c = 3;
\`\`\`
`;

        const blocks = extractCodeBlocks(markdown);
        
        expect(blocks).toHaveLength(3);
        blocks.forEach((block, i) => {
            expect(block.content).toBe(`const ${String.fromCharCode(97 + i)} = ${i + 1};`);
        });
    });

    test('preserves line and offset information', () => {
        const markdown = `# Header

\`\`\`ts
import React from 'react';
export const Foo = () => <div />;
\`\`\`

End`;

        const blocks = extractCodeBlocks(markdown);
        expect(blocks).toHaveLength(1);
        
        const block = blocks[0];
        expect(block.startLine).toBe(2); // Line with opening fence
        expect(block.endLine).toBe(5); // Line with closing fence
        expect(block.startOffset).toBeGreaterThan(0);
        expect(block.endOffset).toBeGreaterThan(block.startOffset);
    });

    test('handles tilde fences', () => {
        const markdown = `
~~~ts
const x = 1;
~~~
`;

        const blocks = extractCodeBlocks(markdown);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].content).toBe('const x = 1;');
    });

    test('handles typescript keyword', () => {
        const markdown = `
\`\`\`typescript
const x: number = 42;
\`\`\`
`;

        const blocks = extractCodeBlocks(markdown);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('typescript');
    });

    test('handles empty code blocks', () => {
        const markdown = `
\`\`\`ts
\`\`\`
`;

        const blocks = extractCodeBlocks(markdown);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].content).toBe('');
    });

    test('handles multiline code blocks with mixed content', () => {
        const markdown = `
\`\`\`tsx
import { Composition } from 'remotion';

const MyScene = () => (
  <Composition
    id="scene"
    component={Frame}
    durationInFrames={30}
    fps={30}
    width={1920}
    height={1080}
  />
);

export default MyScene;
\`\`\`
`;

        const blocks = extractCodeBlocks(markdown);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].content).toContain('import { Composition }');
        expect(blocks[0].content).toContain('export default MyScene;');
    });

    test('classifies bare JSX as jsx-entry', () => {
        const markdown = `
\`\`\`tsx
<Scene />
\`\`\`

\`\`\`tsx
export const Foo = () => <div />;
\`\`\`
`;

        const blocks = extractCodeBlocks(markdown);
        const classified = classifyBlocks(blocks);

        expect(classified[0].type).toBe('jsx-entry');
        expect(classified[1].type).toBe('module');
    });

    test('handles unclosed code blocks gracefully', () => {
        const markdown = `
# Document

\`\`\`ts
const x = 1;
// Missing closing fence
`;

        const blocks = extractCodeBlocks(markdown);
        
        expect(blocks).toHaveLength(1);
        expect(blocks[0].content).toBe('const x = 1;\n// Missing closing fence');
        expect(blocks[0].language).toBe('ts');
    });

});
