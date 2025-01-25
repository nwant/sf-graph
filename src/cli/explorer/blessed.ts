/**
 * Blessed Wrapper
 *
 * Type-safe wrapper for neo-blessed to work around TypeScript issues.
 * Uses dynamic import for ESM compatibility.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let blessedModule: any = null;

/**
 * Lazy-load the blessed module (CommonJS library in ESM project)
 */
export async function loadBlessed(): Promise<any> {
  if (!blessedModule) {
    // Use dynamic import with createRequire for CJS module
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    blessedModule = require('neo-blessed');
  }
  return blessedModule;
}

// For synchronous access after initialization
export function getBlessed(): any {
  if (!blessedModule) {
    throw new Error('Blessed not initialized. Call loadBlessed() first.');
  }
  return blessedModule;
}
