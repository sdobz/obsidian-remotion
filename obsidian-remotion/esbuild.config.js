const esbuild = require('esbuild');
const isProduction = process.env.NODE_ENV === 'production';

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['obsidian', 'path', 'fs', 'esbuild'],  // Mark esbuild as external, bundle esbuild-wasm-resolve
  outfile: 'main.js',
  sourcemap: isProduction ? false : 'inline',
  minify: isProduction,
};

if (process.argv.includes('--watch')) {
  esbuild.context(config).then(ctx => ctx.watch());
} else {
  esbuild.build(config);
}
