const path = require('path')

module.exports = {
    target: 'node',
    mode: 'production',
    entry: './index.ts',
    context: path.resolve(__dirname, 'src'),
    devtool: 'source-map',
    resolve: {
        extensions: ['.ts', '.js'],
    },
    // Disable webpack's built-in "strip-only" TypeScript handling - it can't
    // process decorators or constructor parameter properties, which Angular's
    // DI relies on. Force everything through ts-loader (real tsc) instead.
    experiments: {
        typescript: false,
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                type: 'javascript/auto',
                options: {
                    configFile: path.resolve(__dirname, 'tsconfig.json'),
                },
            },
        ],
    },
    externals: [
        // Anything the running Tabby app already provides must NOT be bundled -
        // otherwise you get duplicate Angular/rxjs instances and DI breaks.
        '@angular/core',
        '@angular/common',
        '@angular/forms',
        'rxjs',
        'rxjs/operators',
        'tabby-core',
        'tabby-ssh',
        'tabby-settings',
        'tabby-terminal',
        'electron',
        'fs',
        'path',
        'child_process',
    ],
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'umd',
    },
}