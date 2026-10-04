// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAttachments } from "./use-attachments";

const CHIP = { type: "attachment", id: "u1", name: "a.txt", mimeType: "text/plain", size: 3, threadId: "t1" };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fileList(...files: File[]): FileList {
  return { length: files.length, item: (i: number) => files[i] ?? null, ...files } as unknown as FileList;
}

describe("useAttachments, listing on mount", () => {
  it("loads the thread's chips when a thread id is present", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ attachments: [CHIP] }));
    const { result } = renderHook(() => useAttachments("t1"));
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/attachments?threadId=t1");
  });

  it("makes no request when there is no thread id yet", async () => {
    renderHook(() => useAttachments(undefined));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never reaches the network when attachments are disabled", async () => {
    const { result } = renderHook(() => useAttachments("t1", undefined, false));
    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.txt")));
      await result.current.remove("u1");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.attachments).toEqual([]);
  });

  it("leaves the chips empty when the list request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "not_found" } }, 404));
    const { result } = renderHook(() => useAttachments("t1"));
    await act(async () => {});
    expect(result.current.attachments).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

describe("useAttachments, minting a thread on the first upload", () => {
  it("mints once, reports the id, and uploads into it", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "minted-1" }))
      .mockResolvedValueOnce(jsonResponse({ attachment: { ...CHIP, threadId: "minted-1" } }))
      .mockResolvedValueOnce(jsonResponse({ attachment: { ...CHIP, id: "u2", threadId: "minted-1" } }));
    const onThreadMinted = vi.fn();
    const { result } = renderHook(() => useAttachments(undefined, onThreadMinted));

    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.txt"), new File(["b"], "b.txt")));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/threads", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onThreadMinted).toHaveBeenCalledTimes(1);
    expect(onThreadMinted).toHaveBeenCalledWith("minted-1");
    expect(result.current.attachments).toHaveLength(2);
  });

  it("mints nothing when the picker was cancelled", async () => {
    const onThreadMinted = vi.fn();
    const { result } = renderHook(() => useAttachments(undefined, onThreadMinted));
    await act(async () => {
      await result.current.upload(null);
      await result.current.upload(fileList());
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onThreadMinted).not.toHaveBeenCalled();
  });

  it("does not mint when a thread id is already known", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ attachments: [] }))
      .mockResolvedValueOnce(jsonResponse({ attachment: CHIP }));
    const { result } = renderHook(() => useAttachments("t1"));
    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.txt")));
    });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/threads")).toBe(false);
  });

  it("surfaces an error and uploads nothing when the mint fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "internal" } }, 500));
    const { result } = renderHook(() => useAttachments(undefined));
    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.txt")));
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.attachments).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useAttachments, removing", () => {
  it("deletes server-side, then drops the chip", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ attachments: [CHIP] }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    const { result } = renderHook(() => useAttachments("t1"));
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    await act(async () => {
      await result.current.remove("u1");
    });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/attachments/u1?threadId=t1", { method: "DELETE" });
    expect(result.current.attachments).toEqual([]);
  });

  it("keeps the chip when the delete fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ attachments: [CHIP] }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "not_found" } }, 404));
    const { result } = renderHook(() => useAttachments("t1"));
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    await act(async () => {
      await result.current.remove("u1");
    });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.error).toBeTruthy();
  });
});

describe("useAttachments, refusal copy", () => {
  it("says the file type is not accepted, not that it cannot be imported", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "unsupported_file" } }, 400));
    const { result } = renderHook(() => useAttachments("t1"));
    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.exe")));
    });
    expect(result.current.error).toContain("attach");
    expect(result.current.error).not.toContain("imported");
  });

  it("says the file is too large on a 413", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "file_too_large" } }, 413));
    const { result } = renderHook(() => useAttachments("t1"));
    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.txt")));
    });
    expect(result.current.error).toContain("too large");
  });
});

describe("useAttachments, pending while a mint or an upload is in flight", () => {
  it("stays pending until the mint settles", async () => {
    let releaseMint!: () => void;
    const mintGate = new Promise<void>((r) => (releaseMint = r));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/threads") {
        await mintGate;
        return jsonResponse({ id: "minted-1" });
      }
      return jsonResponse({ attachment: { ...CHIP, threadId: "minted-1" } });
    });

    const { result } = renderHook(() => useAttachments(undefined));
    expect(result.current.pending).toBe(false);
    let done!: Promise<void>;
    act(() => {
      done = result.current.upload(fileList(new File(["a"], "a.txt")));
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      releaseMint();
      await done;
    });
    expect(result.current.pending).toBe(false);
  });

  it("stays pending until the upload settles", async () => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((r) => (releaseUpload = r));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/attachments?")) return jsonResponse({ attachments: [] });
      if (init?.method === "POST") {
        await uploadGate;
        return jsonResponse({ attachment: CHIP });
      }
      return jsonResponse({}, 500);
    });

    const { result } = renderHook(() => useAttachments("t1"));
    let done!: Promise<void>;
    act(() => {
      done = result.current.upload(fileList(new File(["a"], "a.txt")));
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      releaseUpload();
      await done;
    });
    expect(result.current.pending).toBe(false);
  });

  it("mints once when two uploads race, so both files land in one thread", async () => {
    let releaseMint!: () => void;
    const mintGate = new Promise<void>((r) => (releaseMint = r));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/threads") {
        await mintGate;
        return jsonResponse({ id: "minted-1" });
      }
      return jsonResponse({ attachment: { ...CHIP, threadId: "minted-1" } });
    });

    const { result } = renderHook(() => useAttachments(undefined));
    let both!: Promise<unknown>;
    act(() => {
      both = Promise.all([
        result.current.upload(fileList(new File(["a"], "a.txt"))),
        result.current.upload(fileList(new File(["b"], "b.txt"))),
      ]);
    });
    await act(async () => {
      releaseMint();
      await both;
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/threads")).toHaveLength(1);
    expect(result.current.pending).toBe(false);
  });
});

describe("useAttachments, the mint and the mount listing racing", () => {
  it("keeps the just-uploaded chips when the parent re-renders with the minted id", async () => {
    let releaseList!: () => void;
    const listGate = new Promise<void>((r) => (releaseList = r));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/threads") return jsonResponse({ id: "minted-1" });
      if (String(url).startsWith("/api/attachments?")) {
        await listGate;
        return jsonResponse({ attachments: [] });
      }
      if (init?.method === "POST") return jsonResponse({ attachment: { ...CHIP, threadId: "minted-1" } });
      return jsonResponse({}, 500);
    });

    const { result, rerender } = renderHook(
      ({ threadId }: { threadId?: string }) =>
        useAttachments(threadId, (id) => rerender({ threadId: id })),
      { initialProps: { threadId: undefined as string | undefined } },
    );

    await act(async () => {
      await result.current.upload(fileList(new File(["a"], "a.txt")));
    });
    await act(async () => {
      releaseList();
      await listGate;
    });

    expect(result.current.attachments).toHaveLength(1);
  });
});
