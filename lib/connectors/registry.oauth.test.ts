import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  invalidateConnectorRegistryCache,
  loadConnectorRegistry,
} from "./registry";

describe("loadConnectorRegistry oauth fields", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "conn-oauth-"));
    invalidateConnectorRegistryCache();
  });

  afterEach(() => {
    invalidateConnectorRegistryCache();
    rmSync(root, { recursive: true, force: true });
  });

  function writeYaml(lines: string[]): string {
    const filePath = path.join(root, "connectors.yaml");
    writeFileSync(filePath, lines.join("\n"));
    return filePath;
  }

  it("accepts an oauth entry with a variable secret and exact https auth origins", () => {
    const filePath = writeYaml([
      "connectors:",
      "  linear:",
      "    title: Linear",
      "    transport: http",
      "    url: https://mcp.linear.app/mcp",
      "    groups: [eng]",
      "    auth: oauth",
      "    oauthClientId: the-client-id",
      "    oauthClientSecret: ${LINEAR_OAUTH_SECRET}",
      "    authOrigins:",
      "      - https://auth.linear.app",
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.errors).toEqual([]);
    expect(registry.entries).toHaveLength(1);
    const linear = registry.entries[0];
    expect(linear.auth).toBe("oauth");
    expect(linear.oauthClientId).toBe("the-client-id");
    expect(linear.oauthClientSecret).toBe("${LINEAR_OAUTH_SECRET}");
    expect(linear.authOrigins).toEqual(["https://auth.linear.app"]);
  });

  it("leaves a plain non-oauth entry unaffected", () => {
    const filePath = writeYaml([
      "connectors:",
      "  wiki:",
      "    title: Wiki",
      "    transport: sse",
      "    url: https://w.example.com",
      "    groups: [all-hands]",
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.errors).toEqual([]);
    const wiki = registry.entries[0];
    expect(wiki.auth).toBeUndefined();
    expect(wiki.oauthClientId).toBeUndefined();
    expect(wiki.oauthClientSecret).toBeUndefined();
    expect(wiki.authOrigins).toBeUndefined();
  });

  it("rejects oauth on a stdio connector", () => {
    const filePath = writeYaml([
      "connectors:",
      "  notes:",
      "    title: Notes",
      "    transport: stdio",
      "    command: npx",
      "    groups: [eng]",
      "    auth: oauth",
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].reason).toContain("http or sse");
  });

  it.each(["Authorization", "authorization", "AUTHORIZATION"])(
    "rejects an oauth entry that also carries a %s header",
    (headerKey) => {
      const filePath = writeYaml([
        "connectors:",
        "  linear:",
        "    title: Linear",
        "    transport: http",
        "    url: https://mcp.linear.app/mcp",
        "    groups: [eng]",
        "    auth: oauth",
        `    headers: { ${headerKey}: "Bearer literal" }`,
        "",
      ]);

      const registry = loadConnectorRegistry(filePath);

      expect(registry.entries).toEqual([]);
      expect(registry.errors).toHaveLength(1);
      expect(registry.errors[0].reason).toContain("Authorization");
    },
  );

  it("rejects a literal oauth client secret and accepts a ${VAR} reference", () => {
    const filePath = writeYaml([
      "connectors:",
      "  literal-secret:",
      "    title: Bad",
      "    transport: http",
      "    url: https://mcp.example.com/mcp",
      "    groups: [eng]",
      "    auth: oauth",
      "    oauthClientSecret: raw-literal-value",
      "  ref-secret:",
      "    title: Good",
      "    transport: http",
      "    url: https://mcp.example.com/mcp",
      "    groups: [eng]",
      "    auth: oauth",
      "    oauthClientSecret: ${GOOD_OAUTH_SECRET}",
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("literal-secret");
    expect(registry.errors[0].reason).toContain("VAR");
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0].slug).toBe("ref-secret");
  });

  it.each([
    ["prefix${VAR}", "prefix${GOOD_OAUTH_SECRET}"],
    ["${VAR}suffix", "${GOOD_OAUTH_SECRET}suffix"],
    ["two references", "${ONE}${TWO}"],
  ])("rejects an oauthClientSecret that is not exactly one %s", (_label, value) => {
    const filePath = writeYaml([
      "connectors:",
      "  linear:",
      "    title: Linear",
      "    transport: http",
      "    url: https://mcp.example.com/mcp",
      "    groups: [eng]",
      "    auth: oauth",
      `    oauthClientSecret: "${value}"`,
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].reason).toContain("VAR");
  });

  it("rejects authOrigins on a non-oauth entry", () => {
    const filePath = writeYaml([
      "connectors:",
      "  linear:",
      "    title: Linear",
      "    transport: http",
      "    url: https://mcp.example.com/mcp",
      "    groups: [eng]",
      "    authOrigins:",
      "      - https://auth.example.com",
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].reason).toContain("authOrigins");
  });

  it("rejects an authOrigins entry that is not an exact https origin", () => {
    const filePath = writeYaml([
      "connectors:",
      "  bad-origin:",
      "    title: Bad",
      "    transport: http",
      "    url: https://mcp.example.com/mcp",
      "    groups: [eng]",
      "    auth: oauth",
      "    authOrigins:",
      "      - https://auth.example.com/callback",
      "",
    ]);

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].reason).toContain("origin");
  });
});
