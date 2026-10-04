import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { targetFoldersForRoot } from "./target-folders";

let root: string | undefined;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("targetFoldersForRoot", () => {
  it("returns only existing top-level vault folders in display order", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-target-folders-"));
    fs.mkdirSync(path.join(root, "07-governance"));
    fs.mkdirSync(path.join(root, "03-product"));
    fs.writeFileSync(path.join(root, "README.md"), "# Root");

    expect(targetFoldersForRoot(root)).toEqual(["03-product", "07-governance"]);
  });
});
