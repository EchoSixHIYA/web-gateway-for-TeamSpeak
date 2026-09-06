import { Router, type NextFunction, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import type { Logger } from "../logger.js";
import { AdminInputError, AdminService, type AdminSettingsInput } from "./admin-service.js";
import { AdminSessionStore, isSecureRequest } from "./admin-session.js";
import { AdminLoginRateLimiter, waitFor } from "./login-rate-limit.js";
import { TeamSpeakProbeError } from "../server/teamspeak-probe.js";
import type { AdminSessionSummary } from "../server/voice-bridge.js";

export interface AdminConnectionRecord {
  id: string;
  nickname: string;
  target: string;
  startedAt: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  durationSeconds: number | null;
  status: "active" | "connecting" | "disconnected" | "failed";
  reason: string | null;
}

export interface AdminRouterOptions {
  service: AdminService;
  sessions: AdminSessionStore;
  logger: Logger;
  getActiveSessions(): number;
  getPeakSessions(): number;
  getCreatedSessions?: () => number;
  getSessionSummaries?: () => AdminSessionSummary[];
  terminateSession?: (id: string) => Promise<boolean>;
  version?: string;
  logFile?: string;
  startedAt: number;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  const limiter = new AdminLoginRateLimiter();
  const logger = options.logger.child({ component: "admin-api" });

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_request, response) => {
    response.json({ initialized: options.service.isInitialized() });
  });

  router.get("/session", (request, response) => {
    const session = options.sessions.get(request);
    response.json({
      initialized: options.service.isInitialized(),
      authenticated: Boolean(session),
      mustChangePassword: Boolean(session) && options.service.isPasswordChangeRequired(),
      ...(session ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt } : {}),
    });
  });

  router.post("/login", requireSameOrigin, async (request, response) => {
    if (!options.service.isInitialized()) {
      response.status(409).json({ ok: false, code: "NOT_INITIALIZED" });
      return;
    }
    const peer = request.socket.remoteAddress ?? "unknown";
    const retryAfterMs = limiter.retryAfterMs(peer);
    if (retryAfterMs > 0) {
      response.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      response.status(429).json({ ok: false, code: "RATE_LIMITED", retryAfterMs });
      return;
    }
    const body = asRecord(request.body);
    const username = readString(body, "username", 64).trim();
    const password = readOptionalString(body, "password", 1024);
    if (!await options.service.verifyPassword(username, password)) {
      const delayMs = limiter.recordFailure(peer);
      await waitFor(delayMs);
      options.service.database.addAudit("ADMIN_LOGIN_FAILED");
      logger.warn("Administrator login failed");
      response.status(401).json({ ok: false, code: "INVALID_PASSWORD" });
      return;
    }
    limiter.recordSuccess(peer);
    options.service.database.addAudit("ADMIN_LOGIN_SUCCEEDED");
    const session = options.sessions.create(response, isSecureRequest(request));
    response.json({ ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt, mustChangePassword: options.service.isPasswordChangeRequired() });
  });

  router.post("/change-password", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    try {
      const body = asRecord(request.body);
      await options.service.changePassword(readString(body, "newPassword", 1024));
      response.json({ ok: true, mustChangePassword: false });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/logout", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    options.sessions.destroy(request, response, isSecureRequest(request));
    options.service.database.addAudit("ADMIN_LOGOUT");
    response.json({ ok: true });
  });

  router.use(requireAdmin(options.sessions, options.service));

  router.get("/overview", (_request, response) => {
    response.json(options.service.getOverview(
      options.getActiveSessions(),
      options.getPeakSessions(),
      options.startedAt,
    ));
  });

  router.get("/server", (_request, response) => {
    response.json(options.service.getAdminSettings());
  });

  router.get("/sessions", (_request, response) => {
    response.json({ sessions: options.getSessionSummaries?.() ?? [] });
  });

  router.post("/sessions/:id/terminate", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    if (!options.terminateSession || !id || !(await options.terminateSession(id))) {
      response.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
      return;
    }
    options.service.database.addAudit("ADMIN_SESSION_TERMINATED", { id });
    response.json({ ok: true });
  });

  router.get("/invites", (_request, response) => {
    response.json({ invites: options.service.listManagedInvites() });
  });

  router.post("/invites", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      const body = asRecord(request.body);
      const created = options.service.createManagedInvite({
        channel: readOptionalString(body, "channel", 100),
        expiresInHours: readOptionalNumber(body, "expiresInHours", 1),
        maxUses: readOptionalNumber(body, "maxUses", 0),
      });
      response.status(201).json({ ok: true, ...created });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/invites/:id/revoke", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      const id = typeof request.params.id === "string" ? request.params.id : "";
      if (!id) throw new AdminInputError("INVALID_INVITE_ID", "Invite id is invalid");
      if (!options.service.revokeManagedInvite(id)) {
        response.status(404).json({ ok: false, code: "INVITE_NOT_FOUND" });
        return;
      }
      response.json({ ok: true });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.get("/audit", (request, response) => {
    response.json({ events: options.service.database.recentAudit(readLimit(request.query.limit, 50)) });
  });

  router.get("/logs", (request, response) => {
    const limit = readLimit(request.query.limit, 100);
    response.json({
      available: Boolean(options.logFile && existsSync(options.logFile)),
      entries: readRecentLogs(options.logFile, limit),
      sessions: readConnectionHistory(options.logFile, limit),
    });
  });

  router.get("/diagnostics", (_request, response) => {
    const overview = options.service.getOverview(
      options.getActiveSessions(),
      options.getPeakSessions(),
      options.startedAt,
    ) as unknown as AdminOverview;
    response.json({
      generatedAt: new Date().toISOString(),
      gateway: {
        version: options.version ?? "0.1.0",
        uptimeSeconds: overview.gateway.uptimeSeconds,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      sessions: {
        active: options.getActiveSessions(),
        peak: options.getPeakSessions(),
        created: options.getCreatedSessions?.() ?? 0,
        limit: 100,
      },
      teamSpeak: overview.teamSpeak,
      database: { schemaVersion: options.service.database.schemaVersion },
      logs: { available: Boolean(options.logFile && existsSync(options.logFile)) },
    });
  });

  router.get("/diagnostics/report", (_request, response) => {
    const overview = options.service.getOverview(
      options.getActiveSessions(),
      options.getPeakSessions(),
      options.startedAt,
    ) as unknown as AdminOverview;
    const report = {
      generatedAt: new Date().toISOString(),
      gateway: {
        version: options.version ?? "0.1.0",
        uptimeSeconds: overview.gateway.uptimeSeconds,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      sessions: {
        active: options.getActiveSessions(),
        peak: options.getPeakSessions(),
        created: options.getCreatedSessions?.() ?? 0,
        limit: 100,
      },
      teamSpeak: {
        status: overview.teamSpeak.status,
        lastTestAt: overview.teamSpeak.lastTestAt,
        latencyMs: overview.teamSpeak.latencyMs,
        lastError: overview.teamSpeak.lastError,
      },
      database: { schemaVersion: options.service.database.schemaVersion },
      audit: options.service.database.recentAudit(50),
    };
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="webspeak-diagnostic-report.json"`);
    response.send(JSON.stringify(report, null, 2));
  });

  router.get("/backup", (_request, response) => {
    try {
      const backup = options.service.database.exportBackup();
      options.service.database.addAudit("ADMIN_BACKUP_EXPORTED");
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Disposition", `attachment; filename="webspeak-backup-${new Date().toISOString().slice(0, 10)}.db"`);
      response.send(backup);
    } catch {
      response.status(500).json({ ok: false, code: "BACKUP_FAILED" });
    }
  });

  router.put("/server", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      options.service.updateSettings(readSettingsInput(asRecord(request.body)));
      response.json({ ok: true, settings: options.service.getAdminSettings() });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/server/test", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    const body = asRecord(request.body);
    const action = readPasswordAction(body.passwordAction);
    const password = action === "remove"
      ? ""
      : typeof body.serverPassword === "string"
        ? body.serverPassword.slice(0, 512)
        : options.service.getConnectionPolicy().serverPassword;
    await runProbe(options.service, response, readString(body, "target", 300), password, true);
  });

  router.post("/legacy-import/dismiss", requireSameOrigin, requireCsrf(options.sessions), (_request, response) => {
    options.service.dismissLegacyImportNotice();
    response.json({ ok: true });
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendAdminError(response, error);
  });

  return router;
}

function requireAdmin(sessions: AdminSessionStore, service: AdminService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!sessions.get(request)) {
      response.status(401).json({ ok: false, code: "AUTH_REQUIRED" });
      return;
    }
    if (service.isPasswordChangeRequired()) {
      response.status(403).json({ ok: false, code: "PASSWORD_CHANGE_REQUIRED" });
      return;
    }
    next();
  };
}

function requireCsrf(sessions: AdminSessionStore) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const session = sessions.get(request);
    const csrf = request.header("x-csrf-token");
    if (!session || !csrf || csrf !== session.csrfToken) {
      response.status(403).json({ ok: false, code: "CSRF_REJECTED" });
      return;
    }
    next();
  };
}

function requireSameOrigin(request: Request, response: Response, next: NextFunction): void {
  if (!request.is("application/json")) {
    response.status(415).json({ ok: false, code: "JSON_REQUIRED" });
    return;
  }
  const origin = request.header("origin");
  const host = request.header("host");
  try {
    if (!origin || !host || new URL(origin).host !== host) throw new Error("origin mismatch");
  } catch {
    response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" });
    return;
  }
  next();
}

async function runProbe(
  service: AdminService,
  response: Response,
  target: string,
  password: string,
  persistResult: boolean,
): Promise<void> {
  try {
    response.json(await service.testConnection(target, password, persistResult));
  } catch (error: unknown) {
    if (error instanceof TeamSpeakProbeError) {
      response.status(400).json({ ok: false, code: error.code });
      return;
    }
    sendAdminError(response, error);
  }
}

function readSettingsInput(body: Record<string, unknown>): AdminSettingsInput {
  return {
    target: readString(body, "target", 300),
    serverPassword: typeof body.serverPassword === "string" ? body.serverPassword.slice(0, 512) : undefined,
    passwordAction: readPasswordAction(body.passwordAction),
    accessMode: body.accessMode === "open" ? "open" : body.accessMode === "fixed" ? "fixed" : body.accessMode as never,
    siteName: readString(body, "siteName", 80),
    welcomeText: readOptionalString(body, "welcomeText", 500),
    welcomeTextEn: typeof body.welcomeTextEn === "string" ? body.welcomeTextEn.slice(0, 500) : undefined,
    webRtcEnabled: body.webRtcEnabled === true,
    webRtcUdpStart: readOptionalInteger(body, "webRtcUdpStart"),
    webRtcUdpEnd: readOptionalInteger(body, "webRtcUdpEnd"),
  };
}

function readPasswordAction(value: unknown): "keep" | "replace" | "remove" {
  return value === "replace" || value === "remove" ? value : "keep";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminInputError("INVALID_REQUEST", "Request body is invalid");
  return value as Record<string, unknown>;
}

function readString(body: Record<string, unknown>, key: string, max: number): string {
  if (typeof body[key] !== "string" || body[key].length > max) throw new AdminInputError("INVALID_REQUEST", `${key} is invalid`);
  return body[key];
}

function readOptionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== "number" || !Number.isSafeInteger(body[key])) {
    throw new AdminInputError("INVALID_REQUEST", `${key} is invalid`);
  }
  return body[key];
}

function readOptionalString(body: Record<string, unknown>, key: string, max: number): string {
  return typeof body[key] === "string" ? body[key].slice(0, max) : "";
}

function readOptionalNumber(body: Record<string, unknown>, key: string, fallback: number): number {
  return body[key] === undefined ? fallback : typeof body[key] === "number" ? body[key] : Number.NaN;
}

function readLimit(value: unknown, fallback: number): number {
  const limit = typeof value === "string" ? Number(value) : fallback;
  return Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : fallback;
}

interface AdminLogEntry {
  timestamp: string | null;
  level: string;
  message: string;
  context: Record<string, string | number | boolean>;
}

function readRecentLogs(logFile: string | undefined, limit: number): AdminLogEntry[] {
  if (!logFile) return [];
  try {
    const lines = readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean).slice(-limit);
    return lines.map((line) => {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const context: Record<string, string | number | boolean> = {};
        for (const key of ["component", "entryId", "code", "reason", "attempt", "target", "nickname", "channel", "reconnect", "port"]) {
          const value = raw[key];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") context[key] = value;
        }
        return {
          timestamp: typeof raw.time === "string" ? raw.time : null,
          level: logLevelName(raw.level),
          message: typeof raw.msg === "string" ? raw.msg : "",
          context,
        };
      } catch {
        return { timestamp: null, level: "INFO", message: line.slice(0, 1000), context: {} };
      }
    });
  } catch {
    return [];
  }
}

interface StructuredLogEntry {
  timestamp: string | null;
  message: string;
  raw: Record<string, unknown>;
}

export function readConnectionHistory(logFile: string | undefined, limit: number): AdminConnectionRecord[] {
  if (!logFile) return [];
  const records = new Map<string, {
    id: string;
    nickname: string;
    target: string;
    startedAt: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    durationSeconds: number | null;
    status: AdminConnectionRecord["status"];
    reason: string | null;
  }>();
  for (const log of readStructuredLogs(logFile)) {
    const entryId = typeof log.raw.entryId === "string" ? log.raw.entryId : "";
    if (!entryId || !log.timestamp) continue;
    const current = records.get(entryId) ?? {
      id: entryId,
      nickname: "",
      target: "",
      startedAt: null,
      connectedAt: null,
      disconnectedAt: null,
      durationSeconds: null,
      status: "connecting" as const,
      reason: null,
    };
    const nickname = typeof log.raw.nickname === "string" ? log.raw.nickname : "";
    const target = typeof log.raw.target === "string" ? log.raw.target : "";
    if (nickname) current.nickname = nickname;
    if (target) current.target = target;
    if (log.message === "WebClient connecting") {
      current.startedAt ??= log.timestamp;
      current.status = "connecting";
    } else if (log.message === "Web client connected to TeamSpeak") {
      current.startedAt ??= log.timestamp;
      current.connectedAt = log.timestamp;
      current.status = "active";
    } else if (log.message === "Client session torn down") {
      current.startedAt ??= log.timestamp;
      current.disconnectedAt = log.timestamp;
      current.durationSeconds = current.connectedAt && typeof log.raw.durationSeconds === "number"
        ? Math.max(0, Math.floor(log.raw.durationSeconds))
        : current.connectedAt
          ? Math.max(0, Math.floor((Date.parse(log.timestamp) - Date.parse(current.connectedAt)) / 1000))
          : null;
      current.reason = typeof log.raw.reason === "string" ? log.raw.reason : null;
      current.status = current.connectedAt ? "disconnected" : "failed";
    }
    records.set(entryId, current);
  }
  const now = Date.now();
  return [...records.values()]
    .filter((record): record is typeof record & { startedAt: string } => Boolean(record.startedAt))
    .map((record) => {
      const start = record.connectedAt ?? record.startedAt;
      const end = record.disconnectedAt ? Date.parse(record.disconnectedAt) : now;
      return {
        id: record.id,
        nickname: record.nickname || "—",
        target: record.target || "—",
        startedAt: record.startedAt,
        connectedAt: record.connectedAt,
        disconnectedAt: record.disconnectedAt,
        durationSeconds: record.durationSeconds ?? (record.status === "active" || record.status === "connecting"
          ? Math.max(0, Math.floor((end - Date.parse(start)) / 1000))
          : null),
        status: record.status,
        reason: record.reason,
      };
    })
    .sort((left, right) => Date.parse(right.disconnectedAt ?? right.startedAt) - Date.parse(left.disconnectedAt ?? left.startedAt))
    .slice(0, limit);
}

function readStructuredLogs(logFile: string): StructuredLogEntry[] {
  const paths = [logFile, `${logFile}.1`, `${logFile}.2`, `${logFile}.3`].filter((value, index, all) => value && all.indexOf(value) === index);
  const entries: StructuredLogEntry[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          entries.push({
            timestamp: typeof raw.time === "string" ? raw.time : null,
            message: typeof raw.msg === "string" ? raw.msg : "",
            raw,
          });
        } catch {
          // Non-JSON lines are still shown by the normal log viewer, but cannot
          // be associated with a user session safely.
        }
      }
    } catch {
      // A rotated file can disappear between existsSync and readFileSync.
    }
  }
  return entries.sort((left, right) => Date.parse(left.timestamp ?? "") - Date.parse(right.timestamp ?? ""));
}

interface AdminOverview {
  gateway: { uptimeSeconds: number };
  teamSpeak: {
    target: string;
    status: string;
    lastTestAt: string | null;
    latencyMs: number | null;
    lastError: string | null;
  };
}

function logLevelName(level: unknown): string {
  if (level === 10) return "DEBUG";
  if (level === 30) return "INFO";
  if (level === 40) return "WARN";
  if (level === 50) return "ERROR";
  if (level === 60) return "FATAL";
  return typeof level === "string" ? level.toUpperCase() : "INFO";
}

function sendAdminError(response: Response, error: unknown): void {
  if (error instanceof AdminInputError) {
    response.status(400).json({ ok: false, code: error.code });
    return;
  }
  response.status(500).json({ ok: false, code: "INTERNAL_ERROR" });
}
