import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("latency probe", () => {
  it("persists writes in SQLite and returns timing metadata", async () => {
    const objectName = crypto.randomUUID();
    const write = await SELF.fetch(
      `https://example.test/probe?object=${objectName}&operation=write&payload=hello`,
    );
    expect(write.status).toBe(200);
    const written = await write.json<{
      bootId: string;
      persistedSequence: number;
      payload: string;
      rpcLatencyMs: number;
    }>();
    expect(written.persistedSequence).toBe(1);
    expect(written.payload).toBe("hello");
    expect(written.rpcLatencyMs).toBeGreaterThanOrEqual(0);

    const read = await SELF.fetch(
      `https://example.test/probe?object=${objectName}&operation=read`,
    );
    const stored = await read.json<typeof written>();
    expect(stored.persistedSequence).toBe(1);
    expect(stored.payload).toBe("hello");
    expect(stored.bootId).toBe(written.bootId);
  });

  it("rejects invalid operations", async () => {
    const response = await SELF.fetch("https://example.test/probe?operation=delete");
    expect(response.status).toBe(400);
  });
});
