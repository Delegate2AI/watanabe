/**
 * The source id of the index bundled with the app (see ./marketplace-builtin.ts).
 *
 * Deliberately not a URL, and deliberately not parseable as one, so it can only
 * ever be matched by exact equality: nothing can fetch it, and no configured
 * marketplace URL can collide with it.
 *
 * It lives alone in a leaf module rather than beside either the document or the
 * parser because both of those need it, and importing either from the other
 * would be a cycle. A leaf also keeps it reachable from a test that mocks
 * ./marketplace, which several admin-surface tests do.
 */
export const BUILTIN_MARKETPLACE_ID = "builtin:anthropic-skills";
