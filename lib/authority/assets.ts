import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
const WIKI_LINK = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function markdownFiles(root: string, dir: string = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(root, absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.relative(root, absolute));
    }
  }
  return files;
}

function rawTargets(content: string): string[] {
  return [
    ...[...content.matchAll(MARKDOWN_LINK)].map((match) => match[1].trim().split(/\s+/)[0]),
    ...[...content.matchAll(WIKI_LINK)].map((match) => match[1].trim()),
  ];
}

function assetPath(sourceRoot: string, note: string, rawTarget: string): string | null {
  const unwrapped = rawTarget.startsWith("<") && rawTarget.endsWith(">")
    ? rawTarget.slice(1, -1)
    : rawTarget;
  if (!unwrapped || unwrapped.startsWith("#") || unwrapped.startsWith("//") || URL_SCHEME.test(unwrapped)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(unwrapped.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!decoded || decoded.toLowerCase().endsWith(".md")) return null;
  const candidate = decoded.startsWith("/")
    ? path.resolve(sourceRoot, decoded.slice(1))
    : path.resolve(sourceRoot, path.dirname(note), decoded);
  const relative = path.relative(sourceRoot, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  try {
    return lstatSync(candidate).isFile() ? relative : null;
  } catch {
    return null;
  }
}

export function copyReachableAssets(sourceRoot: string, projectionRoot: string): void {
  const assets = new Set<string>();
  for (const note of markdownFiles(projectionRoot)) {
    const content = readFileSync(path.join(projectionRoot, note), "utf8");
    for (const target of rawTargets(content)) {
      const relative = assetPath(sourceRoot, note, target);
      if (relative) assets.add(relative);
    }
  }
  for (const relative of assets) {
    const destination = path.join(projectionRoot, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(sourceRoot, relative), destination);
  }
}
