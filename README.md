# Cloudflare Durable Object cold-start latency repro

This Worker measures the latency of RPC calls to a SQLite-backed Durable Object. Each response includes end-to-end Worker-to-DO RPC latency, SQLite operation time, constructor/schema time, instance age, and a random `bootId` created by the DO constructor. A changed `bootId` is direct evidence that the object was re-instantiated between probes.

## Run it

```sh
pnpm install
pnpm check
pnpm deploy
```

Then run periodic probes against the deployed URL:

```sh
pnpm probe -- --url https://cf-do-latency-repro.<subdomain>.workers.dev \
  --samples 10 --idle 5 --hibernated 120
```

The client emits one JSON object per request to stdout and a summary to stderr. Redirect stdout to retain raw data:

```sh
pnpm probe -- --url https://cf-do-latency-repro.<subdomain>.workers.dev \
  --samples 10 --idle 5 --hibernated 120
```

Every completed run also creates a timestamped directory under `reports/` containing:

- `report.md`: a lifecycle comparison of newly created/initially inactive, active, idle, and hibernated-or-inactive latency with p50, p90, max, and restart evidence.
- `samples.jsonl`: the complete machine-readable dataset, including warm-up requests.

Use `--output reports/my-run` to choose a stable output directory.

Every probe increments a counter in SQLite, proving that data survives re-instantiation. Use `--object some-name` to select a deterministic DO instance.

The default 120-second interval targets the reported behavior. Cloudflare's lifecycle documentation says hibernateable DOs may hibernate after about 10 seconds of inactivity, while idle non-hibernateable objects are normally evicted after 70–140 seconds. Eviction timing is runtime-controlled, so `bootId`, `instanceAgeMs`, and `rebooted` are more reliable indicators than assuming every delayed request was a cold start.

## Response fields

- `rpcLatencyMs`: time measured in the outer Worker around the DO RPC call.
- `clientLatencyMs`: full public HTTP round trip, added by the probe client.
- `bootId`: random ID generated whenever the DO constructor runs.
- `instanceAgeMs`: time since that constructor started.
- `idleForMs`: time since the prior call to the same in-memory instance; `null` on a fresh instance.
- `sequence`: the SQLite-persisted counter, proving that state survives instance re-instantiation.

Local development validates behavior and persistence, but it cannot reproduce production placement, eviction, or cold-start latency. Use a deployed Worker for meaningful measurements.

## Direct request

```sh
curl 'https://cf-do-latency-repro.<subdomain>.workers.dev/probe?object=repro'
```
