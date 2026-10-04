import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ERROR_CODES } from "./codes";

/**
 * The sweep that keeps the failure contract from rotting back.
 *
 * Before this, roughly forty routes answered with `Response.json({ error:
 * "<sentence>" })`, and most of those sentences came from a caught exception or
 * from a library. One of them named an environment variable. Fixing them once
 * fixes today; this test is what stops the next route from reintroducing the
 * class, because a reviewer no longer has to notice.
 *
 * It reads the route sources as text rather than importing them: a route module
 * pulls in `node:fs`, the database, and the config loader at import time, and
 * the property under test is syntactic anyway.
 */

const API_ROOT = path.join(process.cwd(), "app", "api");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

const ROUTES = routeFiles(API_ROOT).sort();
const rel = (file: string) => path.relative(process.cwd(), file);

/**
 * The two routes that answer an OAuth client rather than this app's own client.
 *
 * RFC 6749 and RFC 7591 specify the payload: a machine-readable `error` code as
 * a STRING, and an optional `error_description`. A client library reads those
 * field names and nothing else, so the failure contract's `{ error: { code } }`
 * would be unreadable to the only caller these endpoints have.
 *
 * The exemption is from the SHAPE rules alone. They stay under the leak rule
 * below, which is the one that matters: their descriptions are literals naming
 * which rule was broken, and neither route forwards a caught exception's
 * message. Adding a route here needs the same to be true of it.
 */
const OAUTH_PROTOCOL_ROUTES = new Set([
  path.join("app", "api", "oauth", "register", "route.ts"),
  path.join("app", "api", "oauth", "token", "route.ts"),
]);

const CONTRACT_ROUTES = ROUTES.filter((file) => !OAUTH_PROTOCOL_ROUTES.has(rel(file)));

/**
 * Strip comments so a comment quoting an old payload shape (or explaining why a
 * route no longer returns one) cannot fail the sweep.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every `Response.json(...)` argument list in `source`, as text.
 *
 * Scans with a depth counter that steps over string and template literals, so a
 * message containing a parenthesis cannot unbalance the match. Scoping to the
 * response call is the point: `log.error({ error: String(e) })` is where a
 * caught message BELONGS, and a package record's own `error` column is data, not
 * a failure payload. Only what a route hands the client is under test.
 */
function responsePayloads(source: string): string[] {
  const payloads: string[] = [];
  const marker = "Response.json(";
  for (let start = source.indexOf(marker); start !== -1; start = source.indexOf(marker, start + 1)) {
    let i = start + marker.length;
    let depth = 1;
    let quote: string | null = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    payloads.push(source.slice(start + marker.length, i - 1));
  }
  return payloads;
}

describe("app/api route failure payloads", () => {
  it("finds the route files, so a broken walk cannot pass by testing nothing", () => {
    expect(ROUTES.length).toBeGreaterThan(30);
  });

  it("extracts response payloads, so a broken scan cannot pass by matching nothing", () => {
    const total = ROUTES.reduce((sum, file) => sum + responsePayloads(code(file)).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it("returns no free-text error payload", () => {
    const offenders: string[] = [];
    for (const file of CONTRACT_ROUTES) {
      for (const payload of responsePayloads(code(file))) {
        if (/\berror:\s*["'`]/.test(payload)) offenders.push(rel(file));
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("exempts only the two OAuth protocol routes, and only from the shape rules", () => {
    expect(ROUTES.length - CONTRACT_ROUTES.length).toBe(OAUTH_PROTOCOL_ROUTES.size);
    // Every exempted path must actually exist, so a rename cannot leave a
    // silently dead exemption behind that quietly covers nothing.
    for (const exempt of OAUTH_PROTOCOL_ROUTES) {
      expect(ROUTES.map(rel)).toContain(exempt);
    }
  });

  it("forwards no caught exception's message and no library's error string", () => {
    // `e instanceof Error ? e.message : ...` and `error: result.error` are the
    // two shapes that used to carry an internal sentence into a body.
    const leak = /\berror:\s*(?:\w+\s+instanceof\s+Error|\w+\.(?:message|error|reason)\b)/;
    const offenders: string[] = [];
    for (const file of ROUTES) {
      for (const payload of responsePayloads(code(file))) {
        if (leak.test(payload)) offenders.push(rel(file));
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("carries an error only as an object, so there is nowhere for a sentence to sit", () => {
    const offenders: string[] = [];
    for (const file of CONTRACT_ROUTES) {
      for (const payload of responsePayloads(code(file))) {
        for (const match of payload.matchAll(/\berror:\s*(\S)/g)) {
          if (match[1] !== "{") offenders.push(`${rel(file)}: error: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names only codes from the closed set wherever it builds a payload by hand", () => {
    const declared = new Set<string>(ERROR_CODES);
    const offenders: string[] = [];
    for (const file of ROUTES) {
      for (const payload of responsePayloads(code(file))) {
        for (const match of payload.matchAll(/\bcode:\s*"([^"]+)"/g)) {
          if (!declared.has(match[1])) offenders.push(`${rel(file)}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("puts no environment variable name in a string literal anywhere under app/api", () => {
    // Reading `process.env.REPO_WRITE_TOKEN` is how a route learns whether the
    // deployment can write. Quoting the name is how it used to end up on the
    // wire, so only the quoted form is the violation.
    const quoted = /(["'`])[^"'`\n]*REPO_WRITE_TOKEN[^"'`\n]*\1/;
    const offenders = ROUTES.filter((file) => quoted.test(code(file))).map(rel);
    expect(offenders).toEqual([]);
  });
});
