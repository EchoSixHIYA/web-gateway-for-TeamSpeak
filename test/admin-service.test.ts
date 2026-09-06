import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AdminService } from "../src/admin/admin-service.js";
import { WebSpeakDatabase } from "../src/persistence/database.js";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";
import { silentLogger } from "./helpers/logger.js";

test("legacy config imports once, seeds the default admin, and allows password rotation", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-admin-service-"));
  const legacyPath = path.join(directory, "config.json");
  const legacyText = JSON.stringify({
    tsHost: "legacy.example.com",
    tsPort: 9988,
    tsServerPassword: "legacy-secret-value",
    tsServerProtocol: "ts6",
    maxClients: 9000,
    port: 9999,
    trustProxy: true,
  }, null, 2);
  writeFileSync(legacyPath, legacyText);
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(
    database,
    loadOrCreateMasterSecret(path.join(directory, "master.key")),
    silentLogger,
    legacyPath,
    async () => ({ ok: true, protocol: "ts6", latencyMs: 4, serverName: "Mock TS", requiresPassword: true }),
  );
  await service.initialize();

  assert.equal(readFileSync(legacyPath, "utf8"), legacyText);
  assert.equal(database.getSettings().tsHost, "legacy.example.com");
  assert.equal(database.getSettings().tsPort, 9988);
  assert.equal(service.getConnectionPolicy().serverPassword, "legacy-secret-value");
  assert.equal(readFileSync(path.join(directory, "webspeak.db")).includes(Buffer.from("legacy-secret-value")), false);
  assert.equal(service.isInitialized(), true);
  assert.equal(await service.verifyPassword("admin", "admin"), true);
  assert.equal(await service.verifyPassword("wrong-user", "admin"), false);
  assert.equal(service.isPasswordChangeRequired(), true);
  await service.changePassword("a-secure-admin-password");
  assert.equal(await service.verifyPassword("admin", "a-secure-admin-password"), true);
  assert.equal(await service.verifyPassword("admin", "admin"), false);
  assert.equal(service.isPasswordChangeRequired(), false);
  assert.equal(service.getPublicConfig().accessMode, "fixed");
  assert.equal(service.getPublicConfig().target, "legacy.example.com:9988");

  service.updateSettings({
    target: "public.example.com:9987",
    serverPassword: "replacement-secret",
    passwordAction: "replace",
    accessMode: "open",
    siteName: "Open WebSpeak",
    welcomeText: "Public gateway",
    webRtcEnabled: true,
    webRtcUdpStart: 41000,
    webRtcUdpEnd: 41099,
  });
  const publicConfig = service.getPublicConfig();
  assert.equal(publicConfig.target, "public.example.com:9987");
  assert.equal(publicConfig.accessMode, "open");
  assert.equal("serverPassword" in service.getAdminSettings(), false);
  assert.equal(service.getAdminSettings().hasPassword, true);
  assert.equal(service.getConnectionPolicy().serverPassword, "replacement-secret");
  assert.equal(service.getAdminSettings().webRtcEnabled, true);
  assert.equal(service.getAdminSettings().webRtcUdpStart, 41000);
  assert.equal(service.getAdminSettings().webRtcUdpEnd, 41099);
  assert.deepEqual(service.getWebRtcAudioOptions(), { enabled: true, udpPortRange: [41000, 41099] });
  assert.throws(() => service.updateSettings({
    target: "public.example.com:9987",
    accessMode: "open",
    siteName: "Open WebSpeak",
    welcomeText: "Public gateway",
    webRtcEnabled: true,
    webRtcUdpStart: 42000,
    webRtcUdpEnd: 42099,
  }), /Disable WebRTC/);
  database.close();
});

test("managed invites are opaque, bounded, revocable, and included in database backups", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-invites-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(
    database,
    loadOrCreateMasterSecret(path.join(directory, "master.key")),
    silentLogger,
    path.join(directory, "missing-config.json"),
  );
  await service.initialize();

  const created = service.createManagedInvite({ channel: "Lobby", expiresInHours: 2, maxUses: 1 });
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.invite.channel, "Lobby");
  assert.equal(created.invite.status, "active");
  assert.equal("token" in created.invite, false);

  const consumed = service.consumeManagedInvite(created.token);
  assert.deepEqual(consumed?.target, { host: "127.0.0.1", port: 9987 });
  assert.equal(consumed?.channel, "Lobby");
  assert.equal(service.consumeManagedInvite(created.token), null);
  assert.equal(service.listManagedInvites()[0]?.status, "exhausted");

  database.createManagedInvite({
    id: "invite-expired-test",
    tokenHash: "expired-token-hash",
    targetHost: "127.0.0.1",
    targetPort: 9987,
    serverPasswordEncrypted: null,
    channel: "Expired",
    expiresAt: new Date(Date.now() - 1).toISOString(),
    maxUses: 0,
  });
  assert.equal(database.consumeManagedInvite("expired-token-hash"), null);
  const revocable = service.createManagedInvite({ channel: "Revocable", expiresInHours: 2, maxUses: 0 });
  assert.equal(service.revokeManagedInvite(revocable.invite.id), true);
  assert.equal(service.listManagedInvites().find((invite) => invite.id === revocable.invite.id)?.status, "revoked");

  const backup = database.exportBackup();
  assert.ok(backup.length > 100);
  database.close();
  const reopened = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  assert.equal(reopened.schemaVersion, 4);
  assert.equal(reopened.listManagedInvites().length, 3);
  reopened.close();
});
