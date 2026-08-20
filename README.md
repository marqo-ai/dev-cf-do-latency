# Cloudflare Durable Object lifecycle latency repro

This repository reproduces the latency difference between calls to a SQLite-backed Durable Object in different lifecycle states.

It is designed to answer one question: **how much slower is a Durable Object call after the object has been removed from memory, compared with an active or briefly idle object?**

The benchmark reports p50, p90, and maximum latency for:

1. A newly created object, which Cloudflare defines as initially inactive.
2. An active, in-memory object.
3. An idle, hibernateable object after 5 seconds without traffic.
4. A hibernated or inactive object after 120 seconds without traffic.

Cloudflare does not expose whether an object waking after a long delay was still hibernated or had transitioned to inactive. The final category is therefore deliberately combined. See Cloudflare's [Durable Object lifecycle documentation](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

## How it works

`src/index.ts` contains one Durable Object and one Worker route:

- `GET /probe?object=<name>` calls the named Durable Object over RPC.
- The Durable Object increments a counter in its SQLite storage.
- The constructor creates a random `bootId` that changes whenever the in-memory instance is recreated.
- The persisted counter demonstrates that SQLite data survives recreation.
- The outer Worker measures only the Worker-to-Durable-Object RPC latency.

`scripts/probe.mjs` creates a cohort of independently named objects and calls every object in each lifecycle phase. Sharing the two waiting periods across the cohort produces multiple samples in about two minutes instead of waiting two minutes separately for every sample.

Each run writes:

- `report.md` — headline p50, p90, and maximum RPC/client latency by lifecycle state.
- `samples.jsonl` — every raw request and its timing, boot ID, instance age, idle duration, and persisted sequence.

## Run the repro

Requirements: Node.js 22+ and pnpm.

```sh
pnpm install
pnpm check
pnpm deploy

pnpm probe -- \
  --url https://cf-do-latency-repro.<subdomain>.workers.dev \
  --samples 10 \
  --idle 5 \
  --hibernated 120
```

Reports are written to a timestamped directory under `reports/`. To choose the path and object-name prefix:

```sh
pnpm probe -- \
  --url https://cf-do-latency-repro.<subdomain>.workers.dev \
  --output reports/my-run \
  --object my-run
```

Use a deployed Worker for meaningful lifecycle latency measurements. Local development can validate RPC and SQLite persistence, but it cannot reproduce production placement or eviction behavior.

## What the fields mean

- `rpcLatencyMs`: time measured by the outer Worker around the Durable Object RPC.
- `clientLatencyMs`: complete public HTTP round trip measured by the Node.js client.
- `bootId`: random identifier for the current in-memory Durable Object instance.
- `newBoot`: whether the boot ID changed since the previous call to that object.
- `instanceAgeMs`: time since the current constructor ran.
- `idleForMs`: time since the previous request handled by the same in-memory instance; `null` after recreation.
- `sequence`: counter persisted in the Durable Object's SQLite storage.

## Cloudflare versions

The project pins current Cloudflare releases so the reproduction does not depend on legacy APIs:

- Wrangler `4.125.0`
- `@cloudflare/vitest-pool-workers` `0.22.0`
- `workerd` `1.20260820.1` through Wrangler
- Compatibility date `2026-08-20`

The Durable Object uses current typed RPC and a `new_sqlite_classes` migration; it does not use the legacy fetch-style Durable Object API or KV-backed Durable Object storage.
