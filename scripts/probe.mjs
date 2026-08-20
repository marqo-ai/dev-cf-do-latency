#!/usr/bin/env node

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    object: { type: "string", default: "repro" },
    operation: { type: "string", default: "read" },
    interval: { type: "string", default: "120" },
    iterations: { type: "string", default: "10" },
    warmup: { type: "string", default: "3" },
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

for (let index = -warmup; index < iterations; index += 1) {
  const phase = index < 0 ? "warmup" : "sample";
  const clientStartedAt = performance.now();
  const response = await fetch(endpoint, { cache: "no-store" });
  const body = await response.json();
  const clientLatencyMs = performance.now() - clientStartedAt;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);

  const rebooted = previousBootId !== undefined && previousBootId !== body.bootId;
  previousBootId = body.bootId;
  const sample = { phase, index: Math.max(index, 0), clientLatencyMs, rebooted, ...body };
  console.log(JSON.stringify(sample));
  if (phase === "sample") samples.push(sample);

  const isLast = index === iterations - 1;
  if (!isLast) {
    const delayMs = index < -1 ? 100 : intervalSeconds * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const latencies = samples.map((sample) => sample.rpcLatencyMs).sort((a, b) => a - b);
console.error(JSON.stringify({
  summary: {
    samples: samples.length,
    reboots: samples.filter((sample) => sample.rebooted).length,
    rpcLatencyMs: {
      min: percentile(latencies, 0),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: percentile(latencies, 1),
    },
  },
}));

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
