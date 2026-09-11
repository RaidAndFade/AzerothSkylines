const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/main.ts',
    devtool: isProd ? false : 'eval-source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'azeroth-skylines.js',
      clean: true,
    },
    module: {
      rules: [
        { test: /\.ts$/, use: { loader: 'ts-loader', options: { transpileOnly: false, compilerOptions: { noEmit: false } } }, exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: 'index.html',
        title: 'Azeroth Skylines',
        inject: 'body',
        minify: isProd && {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
        },
      }),
      new HtmlInlineScriptPlugin(),
    ],
    performance: { hints: false },
    devServer: { static: './dist', port: 8080, host: '0.0.0.0' },
  };
};
