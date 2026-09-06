import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createAdminRouter } from "../src/admin/admin-router.js";
import { AdminService } from "../src/admin/admin-service.js";
import { AdminSessionStore } from "../src/admin/admin-session.js";
import { WebSpeakDatabase } from "../src/persistence/database.js";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";
import { silentLogger } from "./helpers/logger.js";

test("admin API requires the default password to be changed before administration", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-admin-api-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(
    database,
    loadOrCreateMasterSecret(path.join(directory, "master.key")),
    silentLogger,
    path.join(directory, "missing-config.json"),
    async (_target, password) => ({ ok: true, protocol: "ts6", latencyMs: 7, serverName: "Mock Server", requiresPassword: Boolean(password) }),
  );
  await service.initialize();

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({
    service,
    sessions: new AdminSessionStore(),
    logger: silentLogger,
    getActiveSessions: () => 2,
    getPeakSessions: () => 4,
    startedAt: Date.now() - 5000,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const status = await request(origin, "/api/admin/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.response.headers.get("cache-control"), "no-store");
  assert.equal(status.body.initialized, true);
  assert.equal("setupDefaults" in status.body, false);

  const login = await request(origin, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: "admin" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.mustChangePassword, true);
  assert.equal(typeof login.body.csrfToken, "string");
  const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("webspeak_admin="));
  assert.match(login.response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(login.response.headers.get("set-cookie") ?? "", /SameSite=Strict/i);

  const session = await request(origin, "/api/admin/session", { cookie });
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.mustChangePassword, true);

  const blockedOverview = await request(origin, "/api/admin/overview", { cookie });
  assert.equal(blockedOverview.response.status, 403);
  assert.equal(blockedOverview.body.code, "PASSWORD_CHANGE_REQUIRED");

  const shortPassword = await request(origin, "/api/admin/change-password", {
    method: "POST",
    cookie,
    csrf: login.body.csrfToken,
    body: { newPassword: "too-short" },
  });
  assert.equal(shortPassword.response.status, 400);
  assert.equal(shortPassword.body.code, "INVALID_ADMIN_PASSWORD");

  const changed = await request(origin, "/api/admin/change-password", {
    method: "POST",
    cookie,
    csrf: login.body.csrfToken,
    body: { newPassword: "integration-admin-password" },
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.mustChangePassword, false);

  const updatedSession = await request(origin, "/api/admin/session", { cookie });
  assert.equal(updatedSession.body.mustChangePassword, false);
  const overview = await request(origin, "/api/admin/overview", { cookie });
  assert.deepEqual(overview.body.sessions, { active: 2, peak: 4, limit: 100 });

  const rejectedMutation = await request(origin, "/api/admin/server", {
    method: "PUT",
    cookie,
    body: { target: "voice.example.com:9988", accessMode: "open", siteName: "Changed", welcomeText: "" },
  });
  assert.equal(rejectedMutation.response.status, 403);
  assert.equal(rejectedMutation.body.code, "CSRF_REJECTED");

  const saved = await request(origin, "/api/admin/server", {
    method: "PUT",
    cookie,
    csrf: login.body.csrfToken,
    body: {
      target: "voice.example.com:9988",
      passwordAction: "remove",
      accessMode: "open",
      siteName: "Changed",
      welcomeText: "Open access",
      webRtcEnabled: true,
      webRtcUdpStart: 41000,
      webRtcUdpEnd: 41099,
    },
  });
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.settings.accessMode, "open");
  assert.equal(saved.body.settings.hasPassword, false);
  assert.equal(saved.body.settings.webRtcEnabled, true);
  assert.equal(saved.body.settings.webRtcUdpStart, 41000);
  assert.equal(saved.body.settings.webRtcUdpEnd, 41099);

  const lockedPorts = await request(origin, "/api/admin/server", {
    method: "PUT",
    cookie,
    csrf: login.body.csrfToken,
    body: {
      target: "voice.example.com:9988",
      passwordAction: "keep",
      accessMode: "open",
      siteName: "Changed",
      welcomeText: "Open access",
      webRtcEnabled: true,
      webRtcUdpStart: 42000,
      webRtcUdpEnd: 42099,
    },
  });
  assert.equal(lockedPorts.response.status, 400);
  assert.equal(lockedPorts.body.code, "WEBRTC_PORT_LOCKED");

  const invite = await request(origin, "/api/admin/invites", {
    method: "POST",
    cookie,
    csrf: login.body.csrfToken,
    body: { channel: "Lobby", expiresInHours: 4, maxUses: 2 },
  });
  assert.equal(invite.response.status, 201);
  assert.equal(invite.body.ok, true);
  assert.match(invite.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(invite.body.invite.channel, "Lobby");
  assert.equal("token" in invite.body.invite, false);

  const invites = await request(origin, "/api/admin/invites", { cookie });
  assert.equal(invites.body.invites.length, 1);
  assert.equal(invites.body.invites[0].status, "active");
  assert.equal(invites.body.invites[0].target, "voice.example.com:9988");

  const sessions = await request(origin, "/api/admin/sessions", { cookie });
  assert.deepEqual(sessions.body.sessions, []);
  const diagnostics = await request(origin, "/api/admin/diagnostics", { cookie });
  assert.equal(diagnostics.body.database.schemaVersion, 4);
  assert.equal("target" in diagnostics.body.teamSpeak, true);
  assert.equal("protocol" in diagnostics.body.teamSpeak, false);

  const report = await request(origin, "/api/admin/diagnostics/report", { cookie });
  assert.equal(report.response.status, 200);
  assert.match(report.response.headers.get("content-disposition") ?? "", /diagnostic-report\.json/);
  assert.equal("target" in report.body.teamSpeak, false);
  assert.equal("protocol" in report.body.teamSpeak, false);
  assert.equal("serverPassword" in report.body, false);

  const revoked = await request(origin, `/api/admin/invites/${encodeURIComponent(invite.body.invite.id)}/revoke`, {
    method: "POST",
    cookie,
    csrf: login.body.csrfToken,
    body: {},
  });
  assert.equal(revoked.body.ok, true);
  const revokedList = await request(origin, "/api/admin/invites", { cookie });
  assert.equal(revokedList.body.invites[0].status, "revoked");

  const backup = await download(origin, "/api/admin/backup", cookie);
  assert.equal(backup.response.status, 200);
  assert.equal(backup.response.headers.get("content-type"), "application/octet-stream");
  assert.ok(backup.bytes.length > 100);
  assert.equal("serverPassword" in saved.body.settings, false);

  const probe = await request(origin, "/api/admin/server/test", {
    method: "POST",
    cookie,
    csrf: login.body.csrfToken,
    body: { target: "voice.example.com:9988", passwordAction: "remove" },
  });
  assert.equal("protocol" in probe.body, false);
  const settings = await request(origin, "/api/admin/server", { cookie });
  assert.equal("detectedProtocol" in settings.body, false);
  assert.equal(settings.body.lastTestLatencyMs, 7);

  const logout = await request(origin, "/api/admin/logout", { method: "POST", cookie, csrf: login.body.csrfToken, body: {} });
  assert.equal(logout.body.ok, true);
  const denied = await request(origin, "/api/admin/overview", { cookie });
  assert.equal(denied.response.status, 401);

  const oldPassword = await request(origin, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: "admin" },
  });
  assert.equal(oldPassword.response.status, 401);
  const newPassword = await request(origin, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: "integration-admin-password" },
  });
  assert.equal(newPassword.response.status, 200);
  assert.equal(newPassword.body.mustChangePassword, false);
});

async function request(
  origin: string,
  pathname: string,
  options: { method?: string; body?: unknown; cookie?: string; csrf?: string } = {},
): Promise<{ response: Response; body: any }> {
  const method = options.method ?? "GET";
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      accept: "application/json",
      ...(method !== "GET" ? { "content-type": "application/json", origin } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.csrf ? { "x-csrf-token": options.csrf } : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });
  return { response, body: await response.json() };
}

async function download(origin: string, pathname: string, cookie?: string): Promise<{ response: Response; bytes: Uint8Array }> {
  const response = await fetch(`${origin}${pathname}`, {
    headers: { accept: "application/octet-stream", ...(cookie ? { cookie } : {}) },
  });
  return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}
