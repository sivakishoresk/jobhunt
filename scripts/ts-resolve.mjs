// Lets the unit tests import TypeScript files that import each other without a file extension.
// Use: node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-roles.mjs
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context);
    throw e;
  }
}`),
);
