module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/styleSheets.test.ts',
    '<rootDir>/__tests__/profileStudio.test.ts',
    '<rootDir>/__tests__/studioPreferences.test.ts',
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
};
