import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { readConnectionHistory } from "../src/admin/admin-router.js";

test("admin log history groups a user's connection lifecycle", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-admin-log-history-"));
  const logFile = path.join(directory, "webspeak.log");
  const connectedAt = new Date(Date.now() - 8_000).toISOString();
  const disconnectedAt = new Date(Date.now() - 2_000).toISOString();
  const lines = [
    { time: new Date(Date.now() - 9_000).toISOString(), msg: "WebClient connecting", entryId: "entry-a", nickname: "Alice", target: "voice.example.com:9987" },
    { time: connectedAt, msg: "Web client connected to TeamSpeak", entryId: "entry-a", nickname: "Alice", target: "voice.example.com:9987" },
    { time: disconnectedAt, msg: "Client session torn down", entryId: "entry-a", nickname: "Alice", target: "voice.example.com:9987", reason: "websocket-close", durationSeconds: 6 },
    { time: new Date(Date.now() - 1_000).toISOString(), msg: "WebClient connecting", entryId: "entry-b", nickname: "Bob", target: "voice.example.com:9987" },
    { time: new Date(Date.now() - 500).toISOString(), msg: "Web client connected to TeamSpeak", entryId: "entry-b", nickname: "Bob", target: "voice.example.com:9987" },
    { time: new Date(Date.now() - 250).toISOString(), msg: "WebClient connecting", entryId: "entry-c", nickname: "Carol", target: "voice.example.com:9987" },
    { time: new Date(Date.now() - 100).toISOString(), msg: "Client session torn down", entryId: "entry-c", nickname: "Carol", target: "voice.example.com:9987", reason: "teamSpeak-connect-failed", durationSeconds: 0 },
  ].map((entry) => JSON.stringify(entry));
  writeFileSync(logFile, `${lines.join("\n")}\n`);

  const history = readConnectionHistory(logFile, 10);
  assert.equal(history.length, 3);
  const alice = history.find((entry) => entry.id === "entry-a");
  const bob = history.find((entry) => entry.id === "entry-b");
  const carol = history.find((entry) => entry.id === "entry-c");
  assert.equal(alice?.status, "disconnected");
  assert.equal(alice?.durationSeconds, 6);
  assert.equal(alice?.disconnectedAt, disconnectedAt);
  assert.equal(bob?.status, "active");
  assert.equal(bob?.disconnectedAt, null);
  assert.ok((bob?.durationSeconds ?? 0) >= 0);
  assert.equal(carol?.status, "failed");
  assert.equal(carol?.durationSeconds, null);
});
