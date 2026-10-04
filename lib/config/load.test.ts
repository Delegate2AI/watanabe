import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "./load";
import { ConfigError } from "./interpolate";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "portal-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: string) => {
  const p = path.join(dir, name);
  writeFileSync(p, body);
  return p;
};

describe("loadConfig — discovery", () => {
  it("with no file and no PORTAL_CONFIG, yields the defaults", () => {
    const c = loadConfig({}, dir);
    expect(c.auth.mode).toBe("proxy-header");
    expect(c.app.name).toBe("Watanabe");
  });

  it("reads ./portal.yaml from the cwd when present", () => {
    write("portal.yaml", "app:\n  name: My KB\n");
    expect(loadConfig({}, dir).app.name).toBe("My KB");
  });

  it("PORTAL_CONFIG takes precedence over ./portal.yaml", () => {
    write("portal.yaml", "app:\n  name: Ignored\n");
    const other = write("other.yaml", "app:\n  name: Chosen\n");
    expect(loadConfig({ PORTAL_CONFIG: other }, dir).app.name).toBe("Chosen");
  });

  it("a PORTAL_CONFIG naming a missing file is a boot error", () => {
    expect(() => loadConfig({ PORTAL_CONFIG: path.join(dir, "nope.yaml") }, dir)).toThrowError(ConfigError);
  });

  it("an absent ./portal.yaml is NOT an error", () => {
    expect(() => loadConfig({}, dir)).not.toThrow();
  });
});

describe("loadConfig — errors name the file", () => {
  it("malformed YAML throws, quoting the path", () => {
    write("portal.yaml", "app:\n  name: [unclosed\n");
    expect(() => loadConfig({}, dir)).toThrowError(/portal\.yaml/);
  });

  it("a schema violation throws, quoting the failing field path", () => {
    write("portal.yaml", "auth:\n  mode: nonsense\n");
    expect(() => loadConfig({}, dir)).toThrowError(/auth/);
  });

  it("an unresolved ${VAR} throws, naming the variable", () => {
    write("portal.yaml", "auth:\n  mode: jwt\n  jwt:\n    algorithm: HS256\n    secret: ${NOPE}\n    issuer: i\n    audience: a\n");
    expect(() => loadConfig({}, dir)).toThrowError(/\$\{NOPE\}/);
  });

  it("an unknown starter icon throws", () => {
    write("portal.yaml", "app:\n  starters:\n    - id: a\n      label: l\n      sub: s\n      icon: Nope\n      prompt: p\n");
    expect(() => loadConfig({}, dir)).toThrowError(/icon|Nope/i);
  });
});

describe("loadConfig — interpolation", () => {
  it("resolves ${VAR} from the supplied environment", () => {
    write("portal.yaml", "repo:\n  path: ${MY_REPO}\n");
    expect(loadConfig({ MY_REPO: "/kb" }, dir).repo.path).toBe("/kb");
  });
});

describe("loadConfig — precedence: env beats yaml beats defaults", () => {
  it("env LOCAL_REPO_PATH overrides repo.path", () => {
    write("portal.yaml", "repo:\n  path: /from-yaml\n");
    expect(loadConfig({ LOCAL_REPO_PATH: "/from-env" }, dir).repo.path).toBe("/from-env");
  });

  it("yaml repo.path is used when the env var is absent", () => {
    write("portal.yaml", "repo:\n  path: /from-yaml\n");
    expect(loadConfig({}, dir).repo.path).toBe("/from-yaml");
  });

  it("env VAULT_SUBDIR overrides repo.vaultSubdir", () => {
    write("portal.yaml", "repo:\n  vaultSubdir: fromYaml\n");
    expect(loadConfig({ VAULT_SUBDIR: "fromEnv" }, dir).repo.vaultSubdir).toBe("fromEnv");
  });

  it("an empty VAULT_SUBDIR still overrides (it means 'repo root is the vault')", () => {
    write("portal.yaml", "repo:\n  vaultSubdir: docs\n");
    expect(loadConfig({ VAULT_SUBDIR: "" }, dir).repo.vaultSubdir).toBe("");
  });

  it("env PORTAL_PROXY_ASSERT_SECRET overrides auth.proxyHeader.assertSecret", () => {
    write("portal.yaml", "auth:\n  mode: proxy-header\n  proxyHeader:\n    assertSecret: from-yaml\n");
    const c = loadConfig({ PORTAL_PROXY_ASSERT_SECRET: "from-env" }, dir);
    if (c.auth.mode !== "proxy-header") throw new Error("mode");
    expect(c.auth.proxyHeader.assertSecret).toBe("from-env");
  });

  it("defaults apply when neither yaml nor env sets a value", () => {
    expect(loadConfig({}, dir).repo.vaultSubdir).toBe("docs");
  });
});

describe("loadConfig — auth.mode: none fails closed", () => {
  const noneYaml = "auth:\n  mode: none\n  none:\n    email: dev@example.com\n";

  it("refuses to load without PORTAL_ALLOW_NO_AUTH=1", () => {
    write("portal.yaml", noneYaml);
    expect(() => loadConfig({}, dir)).toThrowError(/PORTAL_ALLOW_NO_AUTH/);
  });

  it("loads when PORTAL_ALLOW_NO_AUTH=1 is set", () => {
    write("portal.yaml", noneYaml);
    expect(loadConfig({ PORTAL_ALLOW_NO_AUTH: "1" }, dir).auth.mode).toBe("none");
  });

  // A truthy-looking value is not an opt-in. Only "1", matching
  // PORTAL_ALLOW_DEV_IDENTITY_HEADER's exact-match convention.
  it("does not accept PORTAL_ALLOW_NO_AUTH=true", () => {
    write("portal.yaml", noneYaml);
    expect(() => loadConfig({ PORTAL_ALLOW_NO_AUTH: "true" }, dir)).toThrowError(/PORTAL_ALLOW_NO_AUTH/);
  });

  it("the guard does not fire for the other modes", () => {
    write("portal.yaml", "auth:\n  mode: proxy-header\n");
    expect(() => loadConfig({}, dir)).not.toThrow();
  });
});

describe("loadConfig: oidc mode requires its secrets", () => {
  const yaml = [
    "auth:",
    "  mode: oidc",
    "  oidc:",
    "    clientId: abc.apps.googleusercontent.com",
    "    baseUrl: https://portal.example.com",
    "    allowedDomains: [example.com]",
    "",
  ].join("\n");

  const good = {
    PORTAL_OIDC_CLIENT_SECRET: "s3cret",
    PORTAL_SESSION_SECRET: "x".repeat(32),
  };

  it("boots when both secrets are present", () => {
    write("portal.yaml", yaml);
    expect(loadConfig(good, dir).auth.mode).toBe("oidc");
  });

  it("refuses to boot with no client secret", () => {
    write("portal.yaml", yaml);
    expect(() => loadConfig({ PORTAL_SESSION_SECRET: "x".repeat(32) }, dir)).toThrowError(ConfigError);
  });

  it("refuses to boot with a short session secret", () => {
    write("portal.yaml", yaml);
    const env = { ...good, PORTAL_SESSION_SECRET: "too-short" };
    expect(() => loadConfig(env, dir)).toThrowError(/at least 32/);
  });

  it("refuses to boot with neither allowedDomains nor allowedEmails", () => {
    write("portal.yaml", yaml.replace("    allowedDomains: [example.com]\n", ""));
    expect(() => loadConfig(good, dir)).toThrowError(/allowedDomains or allowedEmails/);
  });

  it("refuses to boot when a non-google provider has no issuer", () => {
    write("portal.yaml", yaml.replace("    clientId:", "    provider: logto\n    clientId:"));
    expect(() => loadConfig(good, dir)).toThrowError(/issuer/);
  });

  it("does not touch the other modes", () => {
    write("portal.yaml", "auth:\n  mode: proxy-header\n");
    expect(() => loadConfig({}, dir)).not.toThrow();
  });

  it("refuses to boot with a non-loopback http baseUrl", () => {
    write("portal.yaml", yaml.replace("https://portal.example.com", "http://portal.example.com"));
    expect(() => loadConfig(good, dir)).toThrowError(ConfigError);
  });

  it("boots with a loopback http baseUrl, for local development", () => {
    write("portal.yaml", yaml.replace("https://portal.example.com", "http://localhost:3100"));
    expect(loadConfig(good, dir).auth.mode).toBe("oidc");
  });

  it("refuses to boot when provider: google carries an explicit issuer", () => {
    write(
      "portal.yaml",
      yaml.replace("  oidc:", "  oidc:\n    issuer: https://accounts.google.com"),
    );
    expect(() => loadConfig(good, dir)).toThrowError(ConfigError);
  });
});
