import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { WebSpeakDatabase, DATABASE_SCHEMA_VERSION } from "../src/persistence/database.js";
import { hashAdminPassword } from "../src/security/admin-password.js";

test("SQLite persistence initializes schema and stores the single admin/settings model", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-db-"));
  const dbPath = path.join(directory, "webspeak.db");
  const database = new WebSpeakDatabase(dbPath);
  assert.equal(database.schemaVersion, DATABASE_SCHEMA_VERSION);
  assert.equal(database.hasAdmin(), false);
  assert.equal(database.getSettings().accessMode, "fixed");

  const credential = await hashAdminPassword("database-admin-password");
  database.initializeAdmin(credential, {
    siteName: "Private Voice",
    welcomeText: "Welcome",
    welcomeTextEn: "",
    accessMode: "open",
    tsHost: "voice.example.com",
    tsPort: 9988,
    tsPasswordEncrypted: "v1:ciphertext",
    webRtcEnabled: true,
    webRtcUdpStart: 41000,
    webRtcUdpEnd: 41099,
  });
  assert.equal(database.hasAdmin(), true);
  assert.equal(database.getAdminCredential()?.hash, credential.hash);
  assert.deepEqual(database.getSettings(), {
    siteName: "Private Voice",
    welcomeText: "Welcome",
    welcomeTextEn: "",
    accessMode: "open",
    tsHost: "voice.example.com",
    tsPort: 9988,
    tsPasswordEncrypted: "v1:ciphertext",
    detectedProtocol: null,
    lastTestAt: null,
    lastTestLatencyMs: null,
    lastTestError: null,
    webRtcEnabled: true,
    webRtcUdpStart: 41000,
    webRtcUdpEnd: 41099,
    updatedAt: database.getSettings().updatedAt,
  });
  assert.equal(database.recentAudit()[0]?.event, "ADMIN_INITIALIZED");
  database.close();

  const reopened = new WebSpeakDatabase(dbPath);
  assert.equal(reopened.hasAdmin(), true);
  assert.equal(reopened.getSettings().siteName, "Private Voice");
  reopened.close();
});

test("SQLite schema v1 upgrades to v4 with a migration copy", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-db-migration-"));
  const dbPath = path.join(directory, "webspeak.db");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE admin_credentials (id INTEGER PRIMARY KEY CHECK (id = 1), credential_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), site_name TEXT NOT NULL, welcome_text TEXT NOT NULL,
      access_mode TEXT NOT NULL CHECK (access_mode IN ('fixed', 'open')), ts_host TEXT NOT NULL,
      ts_port INTEGER NOT NULL, ts_password_encrypted TEXT, detected_protocol TEXT,
      last_test_at TEXT, last_test_latency_ms INTEGER, last_test_error TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO settings VALUES (1, 'Legacy', '', 'fixed', '127.0.0.1', 9987, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z');
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const upgraded = new WebSpeakDatabase(dbPath);
  assert.equal(upgraded.schemaVersion, 4);
  assert.equal(upgraded.getSettings().webRtcEnabled, false);
  assert.equal(upgraded.getSettings().webRtcUdpStart, 40000);
  assert.equal(upgraded.getSettings().webRtcUdpEnd, 40099);
  assert.equal(upgraded.getSettings().welcomeTextEn, "");
  assert.equal(upgraded.listManagedInvites().length, 0);
  assert.equal(existsSync(`${dbPath}.schema-1.bak`), true);
  upgraded.close();
});
