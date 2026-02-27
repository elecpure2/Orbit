const esbuild = require('esbuild');

esbuild.buildSync({
    entryPoints: ['windows/main/renderer.js'],
    bundle: true,
    outfile: 'windows/main/renderer.bundle.js',
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    minify: false,
    sourcemap: true,
});

console.log('[build] renderer.bundle.js created');
