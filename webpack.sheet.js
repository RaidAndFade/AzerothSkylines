/** Builds the development sprite contact sheet (see src/dev/sheet.ts). */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/dev/sheet.ts',
  devtool: false,
  output: { path: path.resolve(__dirname, 'dist'), filename: 'sheet.js' },
  module: {
    rules: [
      { test: /\.ts$/, use: { loader: 'ts-loader', options: { compilerOptions: { noEmit: false } } }, exclude: /node_modules/ },
    ],
  },
  resolve: { extensions: ['.ts', '.js'], alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    new HtmlWebpackPlugin({ filename: 'sheet.html', title: 'Sprite sheet', inject: 'body' }),
    new HtmlInlineScriptPlugin(),
  ],
  performance: { hints: false },
};
