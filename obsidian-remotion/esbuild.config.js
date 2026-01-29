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
  external: ['obsidian', 'path', 'fs', 'esbuild'],
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
