#!/usr/bin/env node

import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const runStartedAt = new Date();

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    object: { type: "string", default: "repro" },
    operation: { type: "string", default: "read" },
    interval: { type: "string", default: "120" },
    iterations: { type: "string", default: "10" },
    warmup: { type: "string", default: "3" },
    output: { type: "string" },
  },
});

if (!values.url) {
  console.error("Usage: pnpm probe -- --url https://<worker>.workers.dev [--interval 120] [--iterations 10]");
  process.exit(1);
}

const intervalSeconds = positiveNumber(values.interval, "interval");
const iterations = positiveInteger(values.iterations, "iterations");
const warmup = nonNegativeInteger(values.warmup, "warmup");
if (values.operation !== "read" && values.operation !== "write") {
  throw new Error("operation must be read or write");
}

const endpoint = new URL("/probe", values.url);
endpoint.searchParams.set("object", values.object);
endpoint.searchParams.set("operation", values.operation);

let previousBootId;
const samples = [];
const allSamples = [];

for (let index = -warmup; index < iterations; index += 1) {
  const phase = index < 0 ? "warmup" : "sample";
  const clientStartedAt = performance.now();
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.json();
  const clientLatencyMs = performance.now() - clientStartedAt;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);

  const rebooted = previousBootId !== undefined && previousBootId !== body.bootId;
  previousBootId = body.bootId;
  const sampleIndex = phase === "warmup" ? index + warmup : index;
  const sample = { phase, index: sampleIndex, clientLatencyMs, rebooted, ...body };
  console.log(JSON.stringify(sample));
  allSamples.push(sample);
  if (phase === "sample") samples.push(sample);

  const isLast = index === iterations - 1;
  if (!isLast) {
    const delayMs = index < -1 ? 100 : intervalSeconds * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const latencies = samples.map((sample) => sample.rpcLatencyMs).sort((a, b) => a - b);
const summary = {
  samples: samples.length,
  reboots: samples.filter((sample) => sample.rebooted).length,
  rpcLatencyMs: {
    min: percentile(latencies, 0),
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: percentile(latencies, 1),
  },
};
console.error(JSON.stringify({ summary }));

const outputDirectory = resolve(values.output ?? `reports/${runStartedAt.toISOString().replaceAll(":", "-")}`);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "samples.jsonl"),
  `${allSamples.map((sample) => JSON.stringify(sample)).join("\n")}\n`,
);
await writeFile(resolve(outputDirectory, "report.md"), renderReport({
  endpoint: endpoint.toString(),
  intervalSeconds,
  warmup,
  iterations,
  runStartedAt,
  runFinishedAt: new Date(),
  samples: allSamples,
  summary,
}));
console.error(`Report: ${resolve(outputDirectory, "report.md")}`);
console.error(`Raw samples: ${resolve(outputDirectory, "samples.jsonl")}`);

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? sorted[0];
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function positiveInteger(value, name) {
  const parsed = positiveNumber(value, name);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function renderReport(run) {
  const measured = run.samples.filter((sample) => sample.phase === "sample");
  const warm = run.samples.filter(
    (sample, index) => sample.phase === "warmup" && index > 0 && !sample.rebooted,
  );
  const warmRpc = warm.map((sample) => sample.rpcLatencyMs).sort((a, b) => a - b);
  const cold = measured.filter((sample) => sample.rebooted || sample.idleForMs === null);
  const coldRpc = cold.map((sample) => sample.rpcLatencyMs).sort((a, b) => a - b);
  const warmMedian = percentile(warmRpc, 0.5);
  const coldMedian = percentile(coldRpc, 0.5);
  const ratio = warmMedian && coldMedian ? coldMedian / warmMedian : null;
  const rows = run.samples.map((sample) =>
    `| ${sample.phase} ${sample.index} | ${sample.rpcLatencyMs.toFixed(1)} | ${sample.clientLatencyMs.toFixed(1)} | ${sample.rebooted ? "yes" : "no"} | ${sample.bootId} | ${sample.instanceAgeMs} | ${sample.idleForMs ?? "null"} |`,
  ).join("\n");

  return `# Durable Object latency report

Generated automatically by \`scripts/probe.mjs\`.

## Result

${cold.length === measured.length
    ? `All ${measured.length} measured post-idle calls re-instantiated the Durable Object.`
    : `${cold.length} of ${measured.length} measured post-idle calls re-instantiated the Durable Object.`}
${warmMedian === null || coldMedian === null
    ? "There were not enough warm and cold samples to calculate a comparison."
    : `Median RPC latency was ${warmMedian.toFixed(1)} ms warm and ${coldMedian.toFixed(1)} ms after re-instantiation (${ratio.toFixed(1)}× higher).`}

## Configuration

- Endpoint: \`${run.endpoint}\`
- Started: ${run.runStartedAt.toISOString()}
- Finished: ${run.runFinishedAt.toISOString()}
- Warm-up requests: ${run.warmup}
- Measured requests: ${run.iterations}
- Idle interval: ${run.intervalSeconds} seconds

## Summary

- Re-instantiations: ${run.summary.reboots}/${run.summary.samples}
- Measured RPC latency min: ${format(run.summary.rpcLatencyMs.min)} ms
- Measured RPC latency p50: ${format(run.summary.rpcLatencyMs.p50)} ms
- Measured RPC latency p95: ${format(run.summary.rpcLatencyMs.p95)} ms
- Measured RPC latency max: ${format(run.summary.rpcLatencyMs.max)} ms
- Warm RPC median: ${format(warmMedian)} ms
- Re-instantiated RPC median: ${format(coldMedian)} ms

## Samples

| Request | RPC ms | Client ms | New boot | Boot ID | Instance age ms | Idle ms |
|---|---:|---:|:---:|---|---:|---:|
${rows}

## Interpretation

A changed \`bootId\` proves that the Durable Object constructor ran again. An \`idleForMs\` value of \`null\` and \`instanceAgeMs\` of zero independently identify a fresh in-memory instance. \`rpcLatencyMs\` is measured by the outer Worker around the Durable Object RPC call; \`clientLatencyMs\` includes the public network round trip.

Raw, line-delimited samples are stored beside this report in \`samples.jsonl\`.
`;
}

function format(value) {
  return value === null ? "n/a" : value.toFixed(1);
}
