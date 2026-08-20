# Durable Object latency report

## Headline results

| State | RPC p50 | RPC p90 | RPC max | Client p50 | Client p90 | Client max | New boot IDs |
|---|---:|---:|---:|---:|---:|---:|:---:|
| Newly created / initially inactive | 621.0 | 665.0 | 707.0 | 647.5 | 707.3 | 724.3 | 10/10 |
| Active, in-memory | 30.0 | 32.0 | 86.0 | 45.4 | 52.5 | 100.1 | 0/10 |
| Idle, in-memory hibernateable (5s) | 29.0 | 32.0 | 33.0 | 41.7 | 53.7 | 109.9 | 0/10 |
| Hibernated or inactive (120s) | 367.0 | 514.0 | 781.0 | 431.9 | 533.9 | 797.3 | 10/10 |

All latency values are milliseconds. RPC latency is measured in the Worker around the Durable Object call; client latency is the complete public HTTP round trip.

## Method

- Deployed endpoint: `https://cf-do-latency-repro.edwin-3a8.workers.dev`
- Lifecycle definitions: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Objects per state: 10
- Started: 2026-08-20T20:15:51.995Z
- Finished: 2026-08-20T20:18:09.019Z
- Each first call uses a new, deterministically named SQLite-backed Durable Object. Cloudflare defines every new object as initially inactive.
- Active calls run immediately after all objects have been created.
- Idle calls follow 5 seconds without traffic, below the documented 10-second hibernation threshold.
- Hibernated/inactive calls follow another 120 seconds without traffic.
- A new `bootId` means the constructor ran again. Cloudflare does not expose whether a re-instantiated object was hibernated or had transitioned from hibernated to inactive, so the final state is deliberately combined.
- The SQLite `sequence` counter verifies that persisted data survives new in-memory instances.

Raw results are in `samples.jsonl` beside this report.
