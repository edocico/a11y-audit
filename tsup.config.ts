import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/cli.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  banner: ({ format }) => {
    // Add shebang only to CLI entry in ESM format
    if (format === 'esm') {
      return { js: '' };
    }
    return {};
  },
});
