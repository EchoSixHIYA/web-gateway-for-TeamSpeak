import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AdminCredential } from "../security/admin-password.js";
import type { TeamSpeakProtocol } from "../server/teamspeak-adapter.js";
import { DEFAULT_WEBRTC_UDP_PORT_RANGE } from "../server/webrtc-config.js";

export const DATABASE_SCHEMA_VERSION = 4;
export type AccessMode = "fixed" | "open";

export interface PersistedSettings {
  siteName: string;
  welcomeText: string;
  welcomeTextEn: string;
  accessMode: AccessMode;
  tsHost: string;
  tsPort: number;
  tsPasswordEncrypted: string | null;
  detectedProtocol: TeamSpeakProtocol | null;
  lastTestAt: string | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
  webRtcEnabled: boolean;
  webRtcUdpStart: number;
  webRtcUdpEnd: number;
  updatedAt: string;
}

export interface SettingsUpdate {
  siteName: string;
  welcomeText: string;
  welcomeTextEn?: string;
  accessMode: AccessMode;
  tsHost: string;
  tsPort: number;
  tsPasswordEncrypted: string | null;
  webRtcEnabled: boolean;
  webRtcUdpStart?: number;
  webRtcUdpEnd?: number;
}

export interface ManagedInviteRecord {
  id: string;
  tokenHash: string;
  targetHost: string;
  targetPort: number;
  serverPasswordEncrypted: string | null;
  channel: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  createdAt: string;
  revokedAt: string | null;
}

interface ManagedInviteRow extends Record<string, unknown> {
  id: string;
  token_hash: string;
  target_host: string;
  target_port: number;
  server_password_encrypted: string | null;
  channel: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  created_at: string;
  revoked_at: string | null;
}

interface SettingsRow extends Record<string, unknown> {
  site_name: string;
  welcome_text: string;
  welcome_text_en: string;
  access_mode: string;
  ts_host: string;
  ts_port: number;
  ts_password_encrypted: string | null;
  detected_protocol: string | null;
  last_test_at: string | null;
  last_test_latency_ms: number | null;
  last_test_error: string | null;
  webrtc_enabled: number;
  webrtc_public_host: string;
  webrtc_udp_start: number;
  webrtc_udp_end: number;
  updated_at: string;
}

export class WebSpeakDatabase {
  private readonly database: DatabaseSync;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate(existed);
  }

  close(): void {
    this.database.close();
  }

  get schemaVersion(): number {
    return Number((this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  }

  hasAdmin(): boolean {
    return Boolean(this.database.prepare("SELECT 1 AS present FROM admin_credentials WHERE id = 1").get());
  }

  getAdminCredential(): AdminCredential | null {
    const row = this.database.prepare("SELECT credential_json FROM admin_credentials WHERE id = 1").get() as { credential_json?: string } | undefined;
    if (!row?.credential_json) return null;
    const credential = JSON.parse(row.credential_json) as Partial<AdminCredential>;
    return {
      ...credential,
      version: 1,
      username: typeof credential.username === "string" && credential.username ? credential.username : "admin",
      mustChangePassword: credential.mustChangePassword === true,
    } as AdminCredential;
  }

  initializeAdmin(credential: AdminCredential, settings: SettingsUpdate): void {
    this.transaction(() => {
      if (this.hasAdmin()) throw new Error("WebSpeak is already initialized");
      const now = new Date().toISOString();
      this.database.prepare(
        "INSERT INTO admin_credentials (id, credential_json, created_at, updated_at) VALUES (1, ?, ?, ?)",
      ).run(JSON.stringify(credential), now, now);
      this.writeSettings(settings, now);
      this.insertAudit("ADMIN_INITIALIZED", { accessMode: settings.accessMode, target: `${settings.tsHost}:${settings.tsPort}` }, now);
    });
  }

  updateAdminCredential(credential: AdminCredential): void {
    const now = new Date().toISOString();
    this.database.prepare(
      "UPDATE admin_credentials SET credential_json = ?, updated_at = ? WHERE id = 1",
    ).run(JSON.stringify(credential), now);
  }

  getSettings(): PersistedSettings {
    const row = this.database.prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow;
    return {
      siteName: row.site_name,
      welcomeText: row.welcome_text,
      welcomeTextEn: row.welcome_text_en,
      accessMode: row.access_mode === "open" ? "open" : "fixed",
      tsHost: row.ts_host,
      tsPort: row.ts_port,
      tsPasswordEncrypted: row.ts_password_encrypted,
      detectedProtocol: row.detected_protocol === "ts3" || row.detected_protocol === "ts6" ? row.detected_protocol : null,
      lastTestAt: row.last_test_at,
      lastTestLatencyMs: row.last_test_latency_ms,
      lastTestError: row.last_test_error,
      webRtcEnabled: row.webrtc_enabled === 1,
      webRtcUdpStart: row.webrtc_udp_start,
      webRtcUdpEnd: row.webrtc_udp_end,
      updatedAt: row.updated_at,
    };
  }

  updateSettings(settings: SettingsUpdate, auditEvent = "SETTINGS_CHANGED"): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.writeSettings(settings, now);
      this.insertAudit(auditEvent, { accessMode: settings.accessMode, target: `${settings.tsHost}:${settings.tsPort}` }, now);
    });
  }

  recordConnectionTest(result: {
    protocol: TeamSpeakProtocol | null;
    latencyMs: number | null;
    error: string | null;
  }): void {
    this.database.prepare(
      `UPDATE settings
       SET detected_protocol = ?, last_test_at = ?, last_test_latency_ms = ?, last_test_error = ?
       WHERE id = 1`,
    ).run(result.protocol, new Date().toISOString(), result.latencyMs, result.error);
  }

  clearConnectionTest(): void {
    this.database.exec(
      "UPDATE settings SET detected_protocol = NULL, last_test_at = NULL, last_test_latency_ms = NULL, last_test_error = NULL WHERE id = 1",
    );
  }

  createManagedInvite(record: Omit<ManagedInviteRecord, "createdAt" | "revokedAt" | "useCount">): ManagedInviteRecord {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database.prepare(
        `INSERT INTO managed_invites (
           id, token_hash, target_host, target_port, server_password_encrypted,
           channel, expires_at, max_uses, use_count, created_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
      ).run(
        record.id,
        record.tokenHash,
        record.targetHost,
        record.targetPort,
        record.serverPasswordEncrypted,
        record.channel,
        record.expiresAt,
        record.maxUses,
        now,
      );
    });
    return { ...record, useCount: 0, createdAt: now, revokedAt: null };
  }

  listManagedInvites(): ManagedInviteRecord[] {
    const rows = this.database.prepare(
      "SELECT * FROM managed_invites ORDER BY created_at DESC",
    ).all() as ManagedInviteRow[];
    return rows.map(mapManagedInviteRow);
  }

  revokeManagedInvite(id: string): boolean {
    const result = this.database.prepare(
      "UPDATE managed_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).run(new Date().toISOString(), id) as { changes?: number | bigint };
    return Number(result.changes ?? 0) === 1;
  }

  consumeManagedInvite(tokenHash: string, now = Date.now()): ManagedInviteRecord | null {
    const nowIso = new Date(now).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare(
        `SELECT * FROM managed_invites
         WHERE token_hash = ?
           AND revoked_at IS NULL
           AND expires_at > ?
           AND (max_uses = 0 OR use_count < max_uses)`,
      ).get(tokenHash, nowIso) as ManagedInviteRow | undefined;
      if (!row) {
        this.database.exec("COMMIT");
        return null;
      }
      const result = this.database.prepare(
        `UPDATE managed_invites
         SET use_count = use_count + 1
         WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
           AND (max_uses = 0 OR use_count < max_uses)`,
      ).run(row.id, nowIso) as { changes?: number | bigint };
      if (Number(result.changes ?? 0) !== 1) {
        this.database.exec("COMMIT");
        return null;
      }
      this.database.exec("COMMIT");
      return { ...mapManagedInviteRow(row), useCount: row.use_count + 1 };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exportBackup(): Buffer {
    const exportPath = `${this.path}.export-${randomBytes(8).toString("hex")}.db`;
    try {
      const escapedPath = exportPath.replaceAll("'", "''");
      this.database.exec(`VACUUM INTO '${escapedPath}'`);
      return readFileSync(exportPath);
    } finally {
      try { unlinkSync(exportPath); } catch { /* best effort cleanup */ }
    }
  }

  getMeta(key: string): string | null {
    const row = this.database.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.database.prepare(
      "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  addAudit(event: string, details: Record<string, unknown> = {}): void {
    this.insertAudit(event, details, new Date().toISOString());
  }

  recentAudit(limit = 8): Array<{ event: string; createdAt: string }> {
    const normalizedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.database.prepare(
      "SELECT event, created_at FROM audit_events ORDER BY id DESC LIMIT ?",
    ).all(normalizedLimit) as Array<{ event: string; created_at: string }>;
    return rows.map((row) => ({ event: row.event, createdAt: row.created_at }));
  }

  private migrate(existed: boolean): void {
    let version = this.schemaVersion;
    if (version > DATABASE_SCHEMA_VERSION) {
      throw new Error(`Database schema ${version} is newer than this WebSpeak build`);
    }
    if (existed && version > 0) {
      copyFileSync(this.path, `${this.path}.schema-${version}.bak`);
    }
    if (version === 0) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
          CREATE TABLE admin_credentials (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            credential_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            site_name TEXT NOT NULL,
            welcome_text TEXT NOT NULL,
            access_mode TEXT NOT NULL CHECK (access_mode IN ('fixed', 'open')),
            ts_host TEXT NOT NULL,
            ts_port INTEGER NOT NULL CHECK (ts_port BETWEEN 1 AND 65535),
            ts_password_encrypted TEXT,
            detected_protocol TEXT CHECK (detected_protocol IS NULL OR detected_protocol IN ('ts3', 'ts6')),
            last_test_at TEXT,
            last_test_latency_ms INTEGER,
            last_test_error TEXT,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `);
        const now = new Date().toISOString();
        this.database.prepare(
          `INSERT INTO settings (
             id, site_name, welcome_text, access_mode, ts_host, ts_port,
             ts_password_encrypted, detected_protocol, last_test_at,
             last_test_latency_ms, last_test_error, updated_at
           ) VALUES (1, 'WebSpeak', '', 'fixed', '127.0.0.1', 9987, NULL, NULL, NULL, NULL, NULL, ?)`,
        ).run(now);
        this.database.exec("PRAGMA user_version = 1");
      });
      version = 1;
    }
    if (version === 1) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE managed_invites (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            target_host TEXT NOT NULL,
            target_port INTEGER NOT NULL CHECK (target_port BETWEEN 1 AND 65535),
            server_password_encrypted TEXT,
            channel TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL,
            max_uses INTEGER NOT NULL CHECK (max_uses >= 0),
            use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
            created_at TEXT NOT NULL,
            revoked_at TEXT
          );
          CREATE INDEX managed_invites_token_idx ON managed_invites(token_hash);
          CREATE INDEX managed_invites_expiry_idx ON managed_invites(expires_at);
        `);
        this.database.exec("PRAGMA user_version = 2");
      });
      version = 2;
    }
    if (version === 2) {
      this.transaction(() => {
        this.database.exec(`
          -- WebRTC media ports are stored with the administrator settings so the
          -- same range is used by the gateway and shown in the admin console.
          ALTER TABLE settings ADD COLUMN webrtc_enabled INTEGER NOT NULL DEFAULT 0 CHECK (webrtc_enabled IN (0, 1));
          ALTER TABLE settings ADD COLUMN webrtc_public_host TEXT NOT NULL DEFAULT '';
          ALTER TABLE settings ADD COLUMN webrtc_udp_start INTEGER NOT NULL DEFAULT 40000 CHECK (webrtc_udp_start BETWEEN 1 AND 65535);
          ALTER TABLE settings ADD COLUMN webrtc_udp_end INTEGER NOT NULL DEFAULT 40099 CHECK (webrtc_udp_end BETWEEN 1 AND 65535);
        `);
        this.database.exec("PRAGMA user_version = 3");
      });
      version = 3;
    }
    if (version === 3) {
      this.transaction(() => {
        this.database.exec(`
          ALTER TABLE settings ADD COLUMN welcome_text_en TEXT NOT NULL DEFAULT '';
        `);
        this.database.exec("PRAGMA user_version = 4");
      });
    }
  }

  private writeSettings(settings: SettingsUpdate, now: string): void {
    this.database.prepare(
      `UPDATE settings SET
         site_name = ?, welcome_text = ?, welcome_text_en = ?, access_mode = ?, ts_host = ?, ts_port = ?,
         ts_password_encrypted = ?, webrtc_enabled = ?, webrtc_udp_start = ?,
         webrtc_udp_end = ?, updated_at = ?
       WHERE id = 1`,
    ).run(
      settings.siteName,
      settings.welcomeText,
      settings.welcomeTextEn ?? "",
      settings.accessMode,
      settings.tsHost,
      settings.tsPort,
      settings.tsPasswordEncrypted,
      settings.webRtcEnabled ? 1 : 0,
      settings.webRtcUdpStart ?? DEFAULT_WEBRTC_UDP_PORT_RANGE[0],
      settings.webRtcUdpEnd ?? DEFAULT_WEBRTC_UDP_PORT_RANGE[1],
      now,
    );
  }

  private insertAudit(event: string, details: Record<string, unknown>, now: string): void {
    this.database.prepare(
      "INSERT INTO audit_events (event, details_json, created_at) VALUES (?, ?, ?)",
    ).run(event, JSON.stringify(details), now);
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapManagedInviteRow(row: ManagedInviteRow): ManagedInviteRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    targetHost: row.target_host,
    targetPort: row.target_port,
    serverPasswordEncrypted: row.server_password_encrypted,
    channel: row.channel,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}
