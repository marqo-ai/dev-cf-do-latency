#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const startedAt = new Date();
const { values } = parseArgs({ options: {
  url: { type: "string" },
  object: { type: "string", default: "repro" },
  samples: { type: "string", default: "10" },
  idle: { type: "string", default: "5" },
  hibernated: { type: "string", default: "120" },
  output: { type: "string" },
} });

if (!values.url) {
  console.error("Usage: pnpm probe -- --url https://<worker>.workers.dev [--samples 10]");
  process.exit(1);
}

const sampleCount = integer(values.samples, "samples");
const idleSeconds = number(values.idle, "idle");
const hibernatedSeconds = number(values.hibernated, "hibernated");
const runId = startedAt.toISOString().replaceAll(/[:.]/g, "-");
const objects = Array.from({ length: sampleCount }, (_, index) => `${values.object}-${runId}-${index}`);
const previousBootIds = new Map();
const samples = [];

for (const object of objects) await probe("startup", object);
for (const object of objects) await probe("warm", object);

await wait(idleSeconds);
for (const object of objects) await probe("idle", object);

await wait(hibernatedSeconds);
for (const object of objects) await probe("hibernated", object);

const categories = ["startup", "warm", "idle", "hibernated"];
const summary = Object.fromEntries(categories.map((category) => {
  const group = samples.filter((sample) => sample.category === category);
  return [category, {
    rpcLatencyMs: stats(group.map((sample) => sample.rpcLatencyMs)),
    clientLatencyMs: stats(group.map((sample) => sample.clientLatencyMs)),
    newBoots: group.filter((sample) => sample.newBoot).length,
  }];
}));

const outputDirectory = resolve(values.output ?? `reports/${runId}`);
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "samples.jsonl"), `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`);
await writeFile(resolve(outputDirectory, "report.md"), report());
console.error(`Report: ${resolve(outputDirectory, "report.md")}`);
console.error(`Raw samples: ${resolve(outputDirectory, "samples.jsonl")}`);

async function probe(category, object) {
  const endpoint = new URL("/probe", values.url);
  endpoint.searchParams.set("object", object);
  const before = performance.now();
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.json();
  const clientLatencyMs = performance.now() - before;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);

  const previousBootId = previousBootIds.get(object);
  const sample = {
    category,
    object,
    clientLatencyMs,
    newBoot: previousBootId === undefined || previousBootId !== body.bootId,
    ...body,
  };
  previousBootIds.set(object, body.bootId);
  samples.push(sample);
  console.log(JSON.stringify(sample));
}

function stats(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), max: sorted.at(-1) };
}

function percentile(sorted, fraction) {
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function number(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be non-negative`);
  return parsed;
}

function integer(value, name) {
  const parsed = number(value, name);
  if (!Number.isInteger(parsed) || parsed === 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function wait(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function report() {
  const row = (category, label) => {
    const result = summary[category];
    return `| ${label} | ${fmt(result.rpcLatencyMs.p50)} | ${fmt(result.rpcLatencyMs.p90)} | ${fmt(result.rpcLatencyMs.max)} | ${fmt(result.clientLatencyMs.p50)} | ${fmt(result.clientLatencyMs.p90)} | ${fmt(result.clientLatencyMs.max)} | ${result.newBoots}/${sampleCount} |`;
  };

  return `# Durable Object latency report

## Headline results

| State | RPC p50 | RPC p90 | RPC max | Client p50 | Client p90 | Client max | New boot IDs |
|---|---:|---:|---:|---:|---:|---:|:---:|
${row("startup", "Newly created / initially inactive")}
${row("warm", "Active, in-memory")}
${row("idle", `Idle, in-memory hibernateable (${idleSeconds}s)`)}
${row("hibernated", `Hibernated or inactive (${hibernatedSeconds}s)`)}

All latency values are milliseconds. RPC latency is measured in the Worker around the Durable Object call; client latency is the complete public HTTP round trip.

## Method

- Deployed endpoint: \`${new URL(values.url).origin}\`
- Lifecycle definitions: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Objects per state: ${sampleCount}
- Started: ${startedAt.toISOString()}
- Finished: ${new Date().toISOString()}
- Each first call uses a new, deterministically named SQLite-backed Durable Object. Cloudflare defines every new object as initially inactive.
- Active calls run immediately after all objects have been created.
- Idle calls follow ${idleSeconds} seconds without traffic, below the documented 10-second hibernation threshold.
- Hibernated/inactive calls follow another ${hibernatedSeconds} seconds without traffic.
- A new \`bootId\` means the constructor ran again. Cloudflare does not expose whether a re-instantiated object was hibernated or had transitioned from hibernated to inactive, so the final state is deliberately combined.
- The SQLite \`sequence\` counter verifies that persisted data survives new in-memory instances.

Raw results are in \`samples.jsonl\` beside this report.
`;
}

function fmt(value) {
  return value.toFixed(1);
}
