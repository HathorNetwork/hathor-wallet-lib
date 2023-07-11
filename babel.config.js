// babel.config.js
module.exports = {
  presets: [
    '@babel/preset-react',
    '@babel/preset-typescript',
  ],
  plugins: [
    "@babel/plugin-transform-async-generator-functions",
  ],
  env: {
    node: {
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              node: 'current',
            },
          },
        ],
      ],
    },
    browser: {
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              browsers: [
                "Chrome >= 60",
                "Safari >= 10.1",
                "iOS >= 10.3",
                "Firefox >= 54",
                "Edge >= 15"
              ]
            },
          },
        ],
      ],
    },
  }
};
