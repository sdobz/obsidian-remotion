const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const isProduction = process.env.NODE_ENV === 'production';

// Generic HTML loader plugin for esbuild
const htmlPlugin = {
  name: 'html-loader',
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, async (args) => {
      const html = await fs.promises.readFile(args.path, 'utf-8');
      return {
        contents: `export default ${JSON.stringify(html)};`,
        loader: 'js',
      };
    });
  },
};

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: [
    'obsidian',
    'electron',
    'path',
    'fs',
    'esbuild',
    'codemirror',
    '@codemirror/autocomplete',
    '@codemirror/closebrackets',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/comment',
    '@codemirror/fold',
    '@codemirror/gutter',
    '@codemirror/highlight',
    '@codemirror/history',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/matchbrackets',
    '@codemirror/panel',
    '@codemirror/rangeset',
    '@codemirror/rectangular-selection',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/stream-parser',
    '@codemirror/text',
    '@codemirror/tooltip',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    '@lezer/markdown',
    '@lezer/tree',
  ],
  outfile: 'main.js',
  sourcemap: isProduction ? false : 'inline',
  minify: isProduction,
  plugins: [htmlPlugin],
};

if (process.argv.includes('--watch')) {
  esbuild.context(config).then(ctx => ctx.watch());
} else {
  esbuild.build(config);
}
