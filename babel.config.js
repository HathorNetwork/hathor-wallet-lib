// babel.config.js
module.exports = {
  presets: [
    '@babel/preset-react',
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
      },
    ],
    '@babel/preset-typescript',
  ],
  plugins: [
    "@babel/plugin-transform-async-generator-functions",
    "@babel/plugin-transform-class-properties",
    "@babel/plugin-transform-private-methods",
  ],
};
