// Isolated service tests do not require the native Expo runtime.
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/wardrobeCutout.test.ts',
    '<rootDir>/__tests__/wardrobeCutoutCard.test.ts',
  ],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: ['@babel/preset-typescript'],
        plugins: [
          '@babel/plugin-transform-modules-commonjs',
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
        ],
      },
    ],
  },
  globals: { __DEV__: true },
};
