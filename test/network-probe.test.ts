import assert from "node:assert/strict";
import test from "node:test";
import { collectTeamSpeakPings, pingTeamSpeakHost, pingTeamSpeakSession, summarizeTeamSpeakPings } from "../src/server/network-probe.js";

test("TeamSpeak latency probe uses the protocol command channel", async () => {
  let command = "";
  const result = await pingTeamSpeakSession(async (value) => {
    command = value;
    return [];
  });
  assert.equal(command, "version");
  assert.equal(result.ok, true);
  assert.equal(result.errorCode, undefined);
  assert.equal(typeof result.latencyMs, "number");
});

test("TeamSpeak protocol probe classifies a timeout and aggregates packet loss", async () => {
  const timeout = await pingTeamSpeakSession(async () => {
    throw new Error("packet ack timeout");
  });
  assert.deepEqual(timeout, { ok: false, latencyMs: null, errorCode: "TIMEOUT" });

  let calls = 0;
  const result = await collectTeamSpeakPings(async () => {
    calls += 1;
    return calls === 2
      ? { ok: false, latencyMs: null, errorCode: "TIMEOUT" }
      : { ok: true, latencyMs: calls };
  }, { attempts: 4 });
  assert.equal(calls, 4);
  assert.equal(result.ok, true);
  assert.equal(result.packetLossPercent, 25);
  assert.equal(result.successfulAttempts, 3);
  assert.deepEqual(result.samples, [1, 3, 4]);
});

test("TeamSpeak ping summary reports complete loss without fake latency", () => {
  const result = summarizeTeamSpeakPings([
    { ok: false, latencyMs: null, errorCode: "UNREACHABLE" },
    { ok: false, latencyMs: null, errorCode: "UNREACHABLE" },
  ]);
  assert.deepEqual(result, {
    ok: false,
    latencyMs: null,
    packetLossPercent: 100,
    attempts: 2,
    successfulAttempts: 0,
    samples: [],
    errorCode: "UNREACHABLE",
  });
});

test("admin host ping measures the route without opening a TeamSpeak client", async () => {
  const calls: Array<[string, number]> = [];
  let attempt = 0;
  const result = await pingTeamSpeakHost("106.15.36.235", {
    attempts: 4,
    timeoutMs: 900,
    execute: async (host, timeoutMs) => {
      calls.push([host, timeoutMs]);
      attempt += 1;
      if (attempt === 3) throw new Error("ping timeout");
      return attempt * 2;
    },
  });
  assert.deepEqual(calls, [
    ["106.15.36.235", 900],
    ["106.15.36.235", 900],
    ["106.15.36.235", 900],
    ["106.15.36.235", 900],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.packetLossPercent, 25);
  assert.equal(result.latencyMs, 4);
});

test("admin host ping reports a missing runtime ping tool separately from packet loss", async () => {
  const result = await pingTeamSpeakHost("207.57.123.189", {
    attempts: 1,
    execute: async () => { throw new Error("spawn ping ENOENT"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "PING_UNAVAILABLE");
});
