import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("latency probe", () => {
  it("persists a SQLite counter and returns timing metadata", async () => {
    const objectName = crypto.randomUUID();
    const first = await SELF.fetch(`https://example.test/probe?object=${objectName}`);
    expect(first.status).toBe(200);
    const initial = await first.json<{
      bootId: string;
      sequence: number;
      rpcLatencyMs: number;
    }>();
    expect(initial.sequence).toBe(1);
    expect(initial.rpcLatencyMs).toBeGreaterThanOrEqual(0);

    const second = await SELF.fetch(`https://example.test/probe?object=${objectName}`);
    const stored = await second.json<typeof initial>();
    expect(stored.sequence).toBe(2);
    expect(stored.bootId).toBe(initial.bootId);
  });

  it("documents the probe route", async () => {
    const response = await SELF.fetch("https://example.test/");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("/probe");
  });
});
