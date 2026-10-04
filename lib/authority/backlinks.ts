import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveVaultTargetPath } from "@/lib/vault-links";

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function markdownFiles(root: string, dir: string = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(root, absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files;
}

function targets(content: string, source: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    const href = match[1].trim().split(/\s+/)[0];
    const target = resolveVaultTargetPath(href, source);
    if (target) found.push(target);
  }
  for (const match of content.matchAll(WIKI_LINK)) {
    const href = match[1].trim().endsWith(".md") ? match[1].trim() : `${match[1].trim()}.md`;
    const target = resolveVaultTargetPath(href, source);
    if (target) found.push(target);
  }
  return found;
}

export function buildBacklinkGraph(root: string): Record<string, string[]> {
  const files = markdownFiles(root).sort((a, b) => a.localeCompare(b));
  const included = new Set(files);
  const graph = new Map<string, Set<string>>();
  for (const source of files) {
    const content = readFileSync(path.join(root, source), "utf8");
    for (const target of targets(content, source)) {
      if (!included.has(target)) continue;
      const sources = graph.get(target) ?? new Set<string>();
      sources.add(source);
      graph.set(target, sources);
    }
  }
  return Object.fromEntries(
    [...graph.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([target, sources]) => [target, [...sources].sort((a, b) => a.localeCompare(b))]),
  );
}

export function removeMissingNoteLinks(root: string): void {
  const files = markdownFiles(root);
  const included = new Set(files);
  for (const source of files) {
    const filePath = path.join(root, source);
    const original = readFileSync(filePath, "utf8");
    const withoutMarkdownLeaks = original.replace(MARKDOWN_LINK, (whole, rawHref: string) => {
      const href = rawHref.trim().split(/\s+/)[0];
      const target = resolveVaultTargetPath(href, source);
      return target && !included.has(target) ? "" : whole;
    });
    const sanitized = withoutMarkdownLeaks.replace(WIKI_LINK, (whole, rawTarget: string) => {
      const href = rawTarget.trim().endsWith(".md") ? rawTarget.trim() : `${rawTarget.trim()}.md`;
      const target = resolveVaultTargetPath(href, source);
      return target && !included.has(target) ? "" : whole;
    });
    if (sanitized !== original) writeFileSync(filePath, sanitized, "utf8");
  }
}
