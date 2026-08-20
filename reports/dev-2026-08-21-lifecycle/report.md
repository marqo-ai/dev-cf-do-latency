# Durable Object latency report

## Headline results

| State | RPC p50 | RPC p90 | RPC max | Client p50 | Client p90 | Client max | New boot IDs |
|---|---:|---:|---:|---:|---:|---:|:---:|
| Newly created / initially inactive | 579.0 | 611.0 | 1040.0 | 604.9 | 681.8 | 1053.2 | 10/10 |
| Active, in-memory | 31.0 | 32.0 | 359.0 | 44.0 | 49.1 | 371.4 | 0/10 |
| Idle, in-memory hibernateable (5s) | 30.0 | 31.0 | 324.0 | 44.0 | 126.0 | 336.7 | 0/10 |
| Hibernated or inactive (120s) | 350.0 | 432.0 | 549.0 | 379.4 | 477.2 | 563.1 | 10/10 |

All latency values are milliseconds. RPC latency is measured in the Worker around the Durable Object call; client latency is the complete public HTTP round trip.

## Method

- Deployed endpoint: `https://cf-do-latency-repro.edwin-3a8.workers.dev`
- Lifecycle definitions: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Objects per state: 10
- Started: 2026-08-20T20:47:46.229Z
- Finished: 2026-08-20T20:50:03.339Z
- Each first call uses a new, deterministically named SQLite-backed Durable Object. Cloudflare defines every new object as initially inactive.
- Active calls run immediately after all objects have been created.
- Idle calls follow 5 seconds without traffic, below the documented 10-second hibernation threshold.
- Hibernated/inactive calls follow another 120 seconds without traffic.
- A new `bootId` means the constructor ran again. Cloudflare does not expose whether a re-instantiated object was hibernated or had transitioned from hibernated to inactive, so the final state is deliberately combined.
- The SQLite `sequence` counter verifies that persisted data survives new in-memory instances.

Raw results are in `samples.jsonl` beside this report.
