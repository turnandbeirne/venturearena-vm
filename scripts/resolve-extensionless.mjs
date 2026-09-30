// Node ESM hooks that let scripts/test-update.mjs import the app's real
// modules unchanged.
//
// Two gaps between Node and Vite:
//
// 1. The source uses extensionless relative imports ("./businessUpgrades"),
//    which Vite resolves at build time and Node does not.
// 2. The source imports non-JS assets (`import url from './theme.mp3'`),
//    which Vite turns into a URL string and Node refuses outright. The
//    `load` hook below stands in for that, so a module like
//    audio/musicEngine.js can be tested without stubbing out the module
//    itself.
const ASSET_EXTENSIONS = /\.(mp3|wav|ogg|png|jpe?g|gif|svg|webp|woff2?|css)$/;

export async function resolve(specifier, context, next) {
  if (ASSET_EXTENSIONS.test(specifier)) {
    const url = new URL(specifier, context.parentURL).href;
    return { url, format: 'asset-url', shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.js')) {
      return next(`${specifier}.js`, context);
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (context.format === 'asset-url') {
    // Exactly what a bundler provides: the asset's URL as the default export.
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(url)};`,
    };
  }
  return next(url, context);
}
