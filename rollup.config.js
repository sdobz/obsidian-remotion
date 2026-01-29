import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/main.ts',
  output: {
    file: 'main.js',
    format: 'cjs', // Changed from 'iife'
    name: 'obsidian-remotion',
    sourcemap: true,
    exports: 'auto' // Added to resolve Rollup warning
  },
  external: ['obsidian'], // Mark 'obsidian' as external
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
    terser(),
  ],
  watch: {
    include: 'src/**',
  },
};