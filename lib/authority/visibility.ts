import { readFrontmatter } from "@/lib/index/frontmatter";

export type Visibility = string[] | "unparseable";

export function readVisibility(fileContents: string): Visibility {
  const frontmatter = readFrontmatter(fileContents);
  if (frontmatter.status === "unparseable") return "unparseable";
  const value = frontmatter.fields.visibility;
  if (value === undefined || value === null || value === "") return ["all-hands"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return "unparseable";
}
