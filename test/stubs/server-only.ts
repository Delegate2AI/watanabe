/**
 * Test stub for the `server-only` package.
 *
 * `server-only`'s real entry point throws on import outside a React Server
 * Component graph. That is exactly what we want in the app (it turns "a client
 * component imported lib/config" into a build error rather than a leaked
 * `auth.jwt.secret`), but it also makes the module unimportable under vitest's
 * plain node environment.
 *
 * Aliased in `vitest.config.ts`. This stub is inert on purpose: the guarantee
 * it stands in for is a BUILD-time one enforced by Next.js, not something a
 * unit test can or should assert.
 */
export {};
