module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/accountDetails.test.ts'],
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', {
      babelrc: false,
      configFile: false,
      presets: ['@babel/preset-typescript'],
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    }],
  },
};
