import type { Logger } from "../logger.js";
import { normalizeTeamSpeakError, type WebSpeakErrorCode } from "../errors.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { TSClient } from "./ts-client.js";
import type { TeamSpeakProtocol } from "./teamspeak-adapter.js";

export type ProbeErrorCode =
  | "HOST_NOT_FOUND"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "INVALID_PASSWORD"
  | "PROTOCOL_NEGOTIATION_FAILED"
  | "SERVER_REJECTED"
  | "INTERNAL_ERROR";

export interface TeamSpeakProbeResult {
  ok: true;
  protocol: TeamSpeakProtocol | null;
  latencyMs: number;
  serverName: string | null;
  requiresPassword: boolean;
}

export class TeamSpeakProbeError extends Error {
  constructor(readonly code: ProbeErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TeamSpeakProbeError";
  }
}

interface ProbeAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly protocol?: TeamSpeakProtocol | null;
  getProtocol?(): TeamSpeakProtocol | null;
  execCommandWithResponse?(command: string, timeoutMs?: number): Promise<Record<string, string>[]>;
  readonly client?: {
    execCommandWithResponse(command: string, timeoutMs?: number): Promise<Record<string, string>[]>;
  };
}

export type ProbeAdapterFactory = (input: {
  target: TeamSpeakTarget;
  password: string;
  logger: Logger;
}) => ProbeAdapter;

export async function probeTeamSpeak(
  target: TeamSpeakTarget,
  password: string,
  logger: Logger,
  factory: ProbeAdapterFactory = ({ target: probeTarget, password: probePassword, logger: probeLogger }) =>
    (() => {
      const client = new TSClient({ target: probeTarget, nickname: "WebSpeak Probe", serverPassword: probePassword }, probeLogger);
      return {
        connect: () => client.connect(),
        disconnect: () => client.disconnect(),
        getProtocol: () => client.getProtocol(),
        execCommandWithResponse: (command: string, timeoutMs?: number) => client.execCommandWithResponse(command, timeoutMs),
      };
    })(),
): Promise<TeamSpeakProbeResult> {
  const startedAt = Date.now();
  const adapter = factory({ target, password, logger: logger.child({ component: "teamspeak-probe" }) });
  try {
    await adapter.connect();
    let serverName: string | null = null;
    try {
      const execute = adapter.execCommandWithResponse?.bind(adapter) ?? adapter.client?.execCommandWithResponse.bind(adapter.client);
      if (!execute) throw new Error("Probe adapter does not support commands");
      const rows = await execute("serverinfo", 3000);
      const first = rows[0] ?? {};
      serverName = first.virtualserver_name ?? first.server_name ?? first.name ?? null;
    } catch {
      // A connected server can restrict serverinfo; reachability is still proven.
    }
    return {
      ok: true,
      protocol: adapter.protocol ?? adapter.getProtocol?.() ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      serverName,
      requiresPassword: Boolean(password),
    };
  } catch (error: unknown) {
    throw toProbeError(error);
  } finally {
    try {
      await adapter.disconnect();
    } catch (error: unknown) {
      logger.warn({ err: extractErrorText(error) }, "TeamSpeak probe cleanup failed");
    }
  }
}

export function toProbeError(error: unknown): TeamSpeakProbeError {
  if (error instanceof TeamSpeakProbeError) return error;
  const normalized = normalizeTeamSpeakError(error);
  const raw = `${extractErrorText(error)} ${extractErrorText(normalized.cause)}`.toLocaleLowerCase();
  if (/enotfound|eai_again|getaddrinfo|host not found/.test(raw)) {
    return new TeamSpeakProbeError("HOST_NOT_FOUND", "TeamSpeak host was not found", error);
  }
  const mapping: Record<WebSpeakErrorCode, ProbeErrorCode> = {
    invalid_target: "INTERNAL_ERROR",
    unreachable: "UNREACHABLE",
    timeout: "TIMEOUT",
    authentication_failed: "INVALID_PASSWORD",
    protocol_negotiation_failed: "PROTOCOL_NEGOTIATION_FAILED",
    server_full: "SERVER_REJECTED",
    unknown: "SERVER_REJECTED",
  };
  return new TeamSpeakProbeError(mapping[normalized.code] ?? "INTERNAL_ERROR", normalized.message, error);
}

function extractErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const candidate = error as { code?: unknown; message?: unknown };
  return `${typeof candidate.code === "string" ? candidate.code : ""} ${typeof candidate.message === "string" ? candidate.message : ""}`;
}
