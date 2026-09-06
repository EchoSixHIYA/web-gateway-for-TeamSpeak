import assert from "node:assert/strict";
import test from "node:test";
import { collectTeamSpeakPings, pingTeamSpeakSession, summarizeTeamSpeakPings } from "../src/server/network-probe.js";

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
