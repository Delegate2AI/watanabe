import { z } from "zod";
import { STARTER_ICON_NAMES } from "./icons";
import { isHttpsOrLoopback } from "../http/url-scheme";
import { dropInactiveAuthBlocks } from "./auth-input";

/**
 * `portal.yaml`'s shape (spec 16).
 *
 * Every field has a default equal to today's hardcoded value, so an absent file
 * (or an empty document) reproduces current behavior exactly. That is what
 * makes this additive: no `portal.yaml` means nothing changes.
 *
 * `.strict()` everywhere: a typo like `auth.mod: none` must fail loudly rather
 * than leave `mode` silently at its default. Config typos that "work" are how
 * a portal ends up running an auth mode nobody chose.
 */

const StarterSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    sub: z.string(),
    // Resolved through an allowlist (see ./icons.ts); an unknown name is an
    // error, never a silent fallback to a blank card.
    icon: z.enum(STARTER_ICON_NAMES),
    prompt: z.string().min(1),
  })
  .strict();

const DEFAULT_STARTERS = [
  {
    id: "whats-in-the-kb",
    label: "What's in the knowledge base?",
    sub: "Overview",
    icon: "BookOpen",
    prompt: "What's in the knowledge base? Give me the short version, grounded in docs/.",
  },
  {
    id: "recent-changes",
    label: "Summarize recent changes",
    sub: "What moved lately",
    icon: "GitBranch",
    prompt: "Summarize what has changed in the knowledge base recently.",
  },
  {
    id: "draft-a-document",
    label: "Draft a document",
    sub: "Start from the knowledge base",
    icon: "Layers",
    prompt: "Help me draft a document, grounded in what the knowledge base already says. The topic is ",
  },
  {
    id: "find-a-decision",
    label: "Find a decision",
    sub: "Why we chose what we chose",
    icon: "Scale",
    prompt: "Find the decision recorded in the knowledge base about ",
  },
] as const;

const AppSchema = z
  .object({
    name: z.string().min(1).default("Watanabe"),
    tagline: z.string().default("Your team's knowledge workspace"),
    navLabel: z.string().min(1).default("Knowledge base"),
    /** Threaded into the agent's system prompt (lib/agent/prompts.ts). */
    kbDescription: z.string().default("the team knowledge base"),
    /**
     * Where "Send feedback" points: a `mailto:` address or an http(s) URL for a
     * form. Deliberately OPTIONAL with no default. The help dialog used to ship
     * `mailto:feedback@example.com`, a placeholder that looked like a working
     * channel and swallowed whatever anyone sent it. Unset now hides the link,
     * which is honest: this deployment has no feedback channel.
     */
    feedbackUrl: z
      .string()
      .min(1)
      .refine((value) => /^(mailto:|https?:\/\/)/.test(value), {
        message: "app.feedbackUrl must start with mailto:, http:// or https://",
      })
      .optional(),
    composerPlaceholder: z.string().default("Ask anything about your knowledge base..."),
    starters: z.array(StarterSchema).default([...DEFAULT_STARTERS]),
  })
  .strict()
  // `prefault` (not `default`) so the nested field defaults actually run: a
  // zod v4 `.default({})` injects the literal value without re-parsing it.
  .prefault({});

const AgentSchema = z
  .object({
    houseRules: z.array(z.string().min(1)).default([]),
    houseRulesSummary: z.string().default(""),
    subjectName: z.string().default(""),
    memoryRules: z.array(z.string().min(1)).default([]),
    memoryRulesSummary: z.string().default(""),
  })
  .strict()
  .prefault({});

const GitSchema = z
  .object({
    botName: z.string().min(1).default("Watanabe Portal Bot"),
    botEmail: z.string().min(1).default("portal-bot@watanabe.local"),
    memoryEmail: z.string().min(1).default("portal-memory@watanabe.local"),
  })
  .strict()
  .prefault({});

export const EmbedSchema = z
  .object({
    frameAncestors: z.string().min(1).default("'self' http://localhost:*"),
  })
  .strict()
  .prefault({});

const RepoSchema = z
  .object({
    /**
     * `LOCAL_REPO_PATH` by another name. It inherits that variable's rule (see
     * lib/repo.ts#localDevPath): honored only when `REPO_READ_TOKEN` is unset.
     * Overriding that would silently disable clone-on-boot in a real deploy.
     */
    path: z.string().optional(),
    /** `"."` or `""` means the repo root IS the vault. */
    vaultSubdir: z.string().default("docs"),
  })
  .strict()
  .prefault({});

/**
 * RS256 verifies against a JWKS endpoint; HS256 against a shared secret. Each
 * forbids the other's field. A `secret` sitting next to `RS256` looks
 * configured but is never read, so rotating it would silently do nothing.
 */
const JwtSchema = z
  .discriminatedUnion("algorithm", [
    z
      .object({
        algorithm: z.literal("RS256"),
        jwksUrl: z.url(),
        secret: z.never().optional(),
      })
      .strict(),
    z
      .object({
        algorithm: z.literal("HS256"),
        secret: z.string().min(1),
        jwksUrl: z.never().optional(),
      })
      .strict(),
  ])
  .and(
    z
      .object({
        issuer: z.string().min(1),
        audience: z.string().min(1),
        source: z.enum(["cookie", "bearer"]).default("cookie"),
        cookieName: z.string().min(1).default("portal_session"),
        emailClaim: z.string().min(1).default("email"),
        nameClaim: z.string().min(1).default("name"),
      })
      .strict(),
  );

const ProxyHeaderSchema = z
  .object({
    emailHeader: z.string().min(1).default("X-Auth-Request-Email"),
    userHeader: z.string().min(1).default("X-Auth-Request-User"),
    assertHeader: z.string().min(1).default("X-Portal-Proxy-Assert"),
    /**
     * Optional on purpose. When unset, `X-Auth-Request-*` is trusted
     * unverified and a once-per-process warning fires, preserving today's
     * pre-WS-E rollout behavior rather than breaking existing deploys.
     */
    assertSecret: z.string().optional(),
  })
  .strict()
  .prefault({});

const NoneSchema = z
  .object({
    email: z.email(),
    name: z.string().optional(),
  })
  .strict();

/**
 * The self-hosted OIDC login mode (2026-07-27 spec). Unlike the other three,
 * this mode PERFORMS a login rather than reading the result of one something
 * else performed, so it carries the endpoints and admission rules the flow runs
 * on.
 *
 * Secrets are deliberately absent. The client secret and the session signing
 * key come from the environment, because `portal.yaml` is committed to git in a
 * real deployment. `lib/config/load.ts#assertOidcConfigured` refuses to boot
 * without them, so a half-configured mode fails at startup rather than as a
 * redirect loop on someone's first sign-in.
 */
const HTTPS_OR_LOOPBACK_MESSAGE =
  "must use https, except a loopback host (localhost, 127.0.0.1, ::1) for local development";

const OidcSchema = z
  .object({
    provider: z.enum(["google", "logto", "generic"]).default("google"),
    /**
     * Required for every provider except `google`, whose issuer is fixed at
     * `https://accounts.google.com` and cannot be overridden (see the
     * `superRefine` below): accepting one would let a `provider: google`
     * config point at a non-Google issuer while keeping Google-only `hd`
     * trust, which is exactly the gap `admission.ts`'s hosted-domain check
     * defends against from the other direction.
     */
    issuer: z.url({ protocol: /^https?$/ }).refine(isHttpsOrLoopback, { message: HTTPS_OR_LOOPBACK_MESSAGE }).optional(),
    clientId: z.string().min(1),
    /**
     * The absolute origin of THIS portal. `redirect_uri` is derived from it and
     * never from a request header: a `Host` an attacker controls would decide
     * where the authorization code is delivered.
     */
    baseUrl: z.url({ protocol: /^https?$/ }).refine(isHttpsOrLoopback, { message: HTTPS_OR_LOOPBACK_MESSAGE }),
    allowedDomains: z.array(z.string().min(1)).default([]),
    allowedEmails: z.array(z.email()).default([]),
    scopes: z.array(z.string().min(1)).default(["openid", "email", "profile"]),
    emailClaim: z.string().min(1).default("email"),
    nameClaim: z.string().min(1).default("name"),
    cookieName: z.string().min(1).default("portal_session"),
    /** Capped at a year so a typo cannot mint a decade-long session. */
    sessionTtlHours: z.number().int().positive().max(8760).default(168),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provider === "google" && value.issuer !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "auth.oidc.issuer must not be set when provider is google: Google's issuer is fixed",
        path: ["issuer"],
      });
    }
  });

const AuthSchema = z
  .preprocess(
    dropInactiveAuthBlocks,
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("proxy-header"), proxyHeader: ProxyHeaderSchema }).strict(),
      z.object({ mode: z.literal("jwt"), jwt: JwtSchema }).strict(),
      z.object({ mode: z.literal("none"), none: NoneSchema }).strict(),
      z.object({ mode: z.literal("oidc"), oidc: OidcSchema }).strict(),
    ]),
  )
  .prefault({ mode: "proxy-header", proxyHeader: {} });

/**
 * Spec 34's installable Agent Skills. Optional with no default, unlike every
 * other block here: an absent `skills` key means this portal has no curated
 * marketplace, which is what hides the marketplace tab in the admin UI. A
 * present-but-empty block is the same thing said explicitly.
 */
const SkillsSchema = z
  .object({
    /**
     * Index URLs, each a JSON document listing installable skills. Constrained
     * to http(s) at the schema, not just at fetch time: a plain `z.url()`
     * happily accepts `file:///etc/passwd` and `javascript:...`, which would
     * survive boot and only fail later as a runtime error in an admin screen.
     * A bad scheme is a config typo, and config typos fail at boot here.
     */
    marketplaces: z.array(z.url({ protocol: /^https?$/ })).default([]),
    /**
     * Whether the index bundled with the app is offered alongside the
     * configured ones (see lib/skills/marketplace-builtin.ts). On by default,
     * so a workspace that configures nothing still has a marketplace. Set false
     * for a workspace that wants only its own curated indexes.
     */
    builtinMarketplace: z.boolean().default(true),
  })
  .strict()
  .optional();

export const PortalConfigSchema = z
  .object({
    repo: RepoSchema,
    app: AppSchema,
    agent: AgentSchema,
    git: GitSchema,
    embed: EmbedSchema,
    auth: AuthSchema,
    skills: SkillsSchema,
  })
  .strict();

export type PortalConfig = z.infer<typeof PortalConfigSchema>;
export type AuthConfig = PortalConfig["auth"];
export type OidcConfig = z.infer<typeof OidcSchema>;
export type StarterConfig = z.infer<typeof StarterSchema>;

/** The config an absent `portal.yaml` produces: exactly today's behavior. */
export const DEFAULT_CONFIG: PortalConfig = PortalConfigSchema.parse({});
