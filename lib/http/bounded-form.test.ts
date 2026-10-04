import { describe, it, expect } from "vitest";
import { BodyTooLarge, boundedFormData } from "./bounded-form";

function multipart(bytes: number): Request {
  const form = new FormData();
  form.append("file", new File(["x".repeat(bytes)], "notes.md"));
  return new Request("http://t/upload", { method: "POST", body: form });
}

describe("boundedFormData", () => {
  it("parses a body within the limit", async () => {
    const form = await boundedFormData(multipart(64), 1024 * 1024);
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("refuses a body past the limit, whatever it declares", async () => {
    // The check is on the bytes that actually arrive, so a request that
    // declares nothing (a chunked upload) is bounded the same way.
    await expect(boundedFormData(multipart(4096), 512)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it("passes a malformed body's own error through, rather than calling it too large", async () => {
    const bad = new Request("http://t/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=nope" },
      body: "not multipart at all",
    });
    await expect(boundedFormData(bad, 1024 * 1024)).rejects.not.toBeInstanceOf(BodyTooLarge);
  });
});
