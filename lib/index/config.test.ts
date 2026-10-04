import { afterEach, describe, expect, it } from "vitest";
import { isIndexEnabled, indexCacheDir } from "./config";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
describe("index config", () => {
  it("isIndexEnabled only when INDEX_ENABLED=1", () => {
    process.env.INDEX_ENABLED = "1"; expect(isIndexEnabled()).toBe(true);
    process.env.INDEX_ENABLED = "0"; expect(isIndexEnabled()).toBe(false);
    delete process.env.INDEX_ENABLED; expect(isIndexEnabled()).toBe(false);
  });
  it("indexCacheDir honors override, defaults to /data/index", () => {
    delete process.env.INDEX_CACHE_DIR; expect(indexCacheDir()).toBe("/data/index");
    process.env.INDEX_CACHE_DIR = "/tmp/idx"; expect(indexCacheDir()).toBe("/tmp/idx");
  });
});
