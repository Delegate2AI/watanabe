import { repoUrl } from "@/lib/repo";

export function gitlabApiBase(): string {
  return `${new URL(repoUrl()).origin}/api/v4`;
}

export function encodedProjectPath(): string {
  const url = new URL(repoUrl());
  const projectPath = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  return encodeURIComponent(projectPath);
}
