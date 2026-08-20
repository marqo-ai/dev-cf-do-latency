import { DurableObject } from "cloudflare:workers";

interface ProbeResult {
  bootId: string;
  instanceAgeMs: number;
  idleForMs: number | null;
  sequence: number;
}

export class LatencyDurableObject extends DurableObject<Env> {
  private readonly bootId = crypto.randomUUID();
  private readonly startedAt = Date.now();
  private lastRequestAt?: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counter (value INTEGER NOT NULL);
      INSERT INTO counter SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM counter);
    `);
  }

  probe(): ProbeResult {
    const now = Date.now();
    const sequence = this.ctx.storage.sql
      .exec<{ value: number }>("UPDATE counter SET value = value + 1 RETURNING value")
      .one().value;
    const result = {
      bootId: this.bootId,
      instanceAgeMs: now - this.startedAt,
      idleForMs: this.lastRequestAt === undefined ? null : now - this.lastRequestAt,
      sequence,
    };
    this.lastRequestAt = now;
    return result;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/probe") return new Response("GET /probe?object=repro", { status: 404 });

    const stub = env.LATENCY_DO.getByName(url.searchParams.get("object") ?? "repro");
    const startedAt = performance.now();
    const result = await stub.probe();

    return Response.json({
      observedAt: new Date().toISOString(),
      objectName: url.searchParams.get("object") ?? "repro",
      rpcLatencyMs: performance.now() - startedAt,
      ...result,
    });
  },
} satisfies ExportedHandler<Env>;
