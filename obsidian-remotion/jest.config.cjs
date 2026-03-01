module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '/src/preview/__tests__/runtime.test.ts',
  ],
  moduleNameMapper: {
    '^remotion-md$': '<rootDir>/../remotion-md/src/index.ts',
    '^remotion-md/(.*)$': '<rootDir>/../remotion-md/src/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': 'esbuild-jest',
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@exodus)/)"
  ],
  testTimeout: 30000,
};
