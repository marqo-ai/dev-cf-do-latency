import { DurableObject } from "cloudflare:workers";

type Operation = "read" | "write";

export interface ProbeResult {
  bootId: string;
  constructorStartedAt: number;
  instanceAgeMs: number;
  idleForMs: number | null;
  constructorSqlMs: number;
  operationSqlMs: number;
  operation: Operation;
  persistedSequence: number;
  payload: string;
}

export class LatencyDurableObject extends DurableObject<Env> {
  private readonly bootId = crypto.randomUUID();
  private readonly constructorStartedAt = Date.now();
  private readonly constructorSqlMs: number;
  private lastRequestAt: number | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const sqlStartedAt = performance.now();
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS probe_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        sequence INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO probe_state (singleton, sequence, payload, updated_at)
      VALUES (1, 0, 'initial', 0);
    `);
    this.constructorSqlMs = performance.now() - sqlStartedAt;
  }

  probe(operation: Operation, payload: string): ProbeResult {
    const requestStartedAt = Date.now();
    const sqlStartedAt = performance.now();

    if (operation === "write") {
      this.ctx.storage.sql.exec(
        `UPDATE probe_state
         SET sequence = sequence + 1, payload = ?, updated_at = ?
         WHERE singleton = 1`,
        payload,
        requestStartedAt,
      );
    }

    const row = this.ctx.storage.sql
      .exec<{ sequence: number; payload: string }>(
        "SELECT sequence, payload FROM probe_state WHERE singleton = 1",
      )
      .one();
    const operationSqlMs = performance.now() - sqlStartedAt;
    const idleForMs = this.lastRequestAt === undefined ? null : requestStartedAt - this.lastRequestAt;
    this.lastRequestAt = requestStartedAt;

    return {
      bootId: this.bootId,
      constructorStartedAt: this.constructorStartedAt,
      instanceAgeMs: requestStartedAt - this.constructorStartedAt,
      idleForMs,
      constructorSqlMs: this.constructorSqlMs,
      operationSqlMs,
      operation,
      persistedSequence: row.sequence,
      payload: row.payload,
    };
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        service: "cf-do-latency-repro",
        probe: "GET or POST /probe?object=repro&operation=read|write",
      });
    }

    if (url.pathname !== "/probe") return jsonError("Not found", 404);
    if (request.method !== "GET" && request.method !== "POST") {
      return jsonError("Use GET or POST", 405);
    }

    const objectName = url.searchParams.get("object") ?? "repro";
    const operation = url.searchParams.get("operation") ?? "read";
    if (objectName.length === 0 || objectName.length > 128) {
      return jsonError("object must contain 1-128 characters", 400);
    }
    if (operation !== "read" && operation !== "write") {
      return jsonError("operation must be read or write", 400);
    }

    const payload = url.searchParams.get("payload") ?? crypto.randomUUID();
    if (payload.length > 1024) return jsonError("payload must be at most 1024 characters", 400);

    const stub = env.LATENCY_DO.getByName(objectName);
    const rpcStartedAt = performance.now();
    const result = await stub.probe(operation, payload);
    const rpcLatencyMs = performance.now() - rpcStartedAt;

    const response = {
      observedAt: new Date().toISOString(),
      objectName,
      rpcLatencyMs,
      ...result,
    };
    console.log(JSON.stringify({ message: "probe", ...response }));
    return Response.json(response, { headers: { "cache-control": "no-store" } });
  },
} satisfies ExportedHandler<Env>;
