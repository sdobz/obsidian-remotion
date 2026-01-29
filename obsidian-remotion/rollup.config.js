import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';

const isProduction = process.env.NODE_ENV === 'production';

export default {
  input: 'src/main.ts',
  output: {
    file: 'main.js',
    format: 'cjs',
    name: 'obsidian-remotion',
    sourcemap: true,
    exports: 'auto'
  },
  external: ['obsidian', 'path', 'fs'],
  plugins: [
    resolve({
      preferBuiltins: true,
    }),
    commonjs(),
    json(),
    typescript({ 
      tsconfig: './tsconfig.json',
      compilerOptions: { noEmit: false }
    }),
    ...(isProduction ? [terser()] : []),
  ],
  watch: {
    include: 'src/**',
  },
};