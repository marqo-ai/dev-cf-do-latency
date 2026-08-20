# Durable Object latency report

Generated automatically by `scripts/probe.mjs`.

## Result

All 3 measured post-idle calls re-instantiated the Durable Object.
Median RPC latency was 17.0 ms warm and 235.0 ms after re-instantiation (13.8× higher).

## Configuration

- Endpoint: `https://cf-do-latency-repro.edwin-3a8.workers.dev/probe?object=repro-report-20260821&operation=read`
- Started: 2026-08-20T19:52:56.837Z
- Finished: 2026-08-20T19:58:58.797Z
- Warm-up requests: 3
- Measured requests: 3
- Idle interval: 120 seconds

## Summary

- Re-instantiations: 3/3
- Measured RPC latency min: 217.0 ms
- Measured RPC latency p50: 235.0 ms
- Measured RPC latency p95: 264.0 ms
- Measured RPC latency max: 264.0 ms
- Warm RPC median: 17.0 ms
- Re-instantiated RPC median: 235.0 ms

## Samples

| Request | RPC ms | Client ms | New boot | Boot ID | Instance age ms | Idle ms |
|---|---:|---:|:---:|---|---:|---:|
| warmup 0 | 567.0 | 666.3 | no | 174b6370-0567-4bc1-941f-047968c06e56 | 0 | null |
| warmup 0 | 19.0 | 35.2 | no | 174b6370-0567-4bc1-941f-047968c06e56 | 183 | 183 |
| warmup 0 | 17.0 | 33.8 | no | 174b6370-0567-4bc1-941f-047968c06e56 | 318 | 135 |
| sample 0 | 264.0 | 343.9 | yes | 80cdc701-8c51-446d-ba16-13d723aa7608 | 0 | null |
| sample 1 | 217.0 | 299.2 | yes | 1d4ba829-dafb-464a-aaec-aef475547424 | 0 | null |
| sample 2 | 235.0 | 292.7 | yes | 8055a047-408d-41f9-8bc2-55454534b98c | 0 | null |

## Interpretation

A changed `bootId` proves that the Durable Object constructor ran again. An `idleForMs` value of `null` and `instanceAgeMs` of zero independently identify a fresh in-memory instance. `rpcLatencyMs` is measured by the outer Worker around the Durable Object RPC call; `clientLatencyMs` includes the public network round trip.

Raw, line-delimited samples are stored beside this report in `samples.jsonl`.
