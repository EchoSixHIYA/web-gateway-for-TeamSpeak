import { createConnection } from "node:net";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";

export type TeamSpeakPingErrorCode = "HOST_NOT_FOUND" | "UNREACHABLE" | "TIMEOUT";

export interface TeamSpeakPingAttempt {
  ok: boolean;
  latencyMs: number | null;
  errorCode?: TeamSpeakPingErrorCode;
}

export interface TeamSpeakPingResult {
  ok: boolean;
  latencyMs: number | null;
  packetLossPercent: number;
  attempts: number;
  successfulAttempts: number;
  samples: number[];
  errorCode?: TeamSpeakPingErrorCode;
}

/**
 * Probe the TeamSpeak TCP endpoint without creating a TeamSpeak client.
 * Browsers cannot send ICMP, and TeamSpeak does not expose an ICMP-style UDP
 * echo, so a short TCP connect is the portable reachability signal available
 * to the gateway. The socket is destroyed immediately after the handshake.
 */
export function pingTeamSpeakPort(
  target: TeamSpeakTarget,
  timeoutMs = 1_500,
): Promise<TeamSpeakPingAttempt> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = createConnection({ host: target.host, port: target.port });
    let settled = false;

    const finish = (result: TeamSpeakPingAttempt) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => finish({ ok: false, latencyMs: null, errorCode: "TIMEOUT" }));
    socket.once("connect", () => finish({ ok: true, latencyMs: Math.max(0, Date.now() - startedAt) }));
    socket.once("error", (error: NodeJS.ErrnoException) => finish({
      ok: false,
      latencyMs: null,
      errorCode: error.code === "ENOTFOUND" || error.code === "EAI_AGAIN" ? "HOST_NOT_FOUND" : "UNREACHABLE",
    }));
  });
}

export async function pingTeamSpeak(
  target: TeamSpeakTarget,
  options: { attempts?: number; timeoutMs?: number } = {},
): Promise<TeamSpeakPingResult> {
  const attempts = Math.max(1, Math.min(8, Math.floor(options.attempts ?? 4)));
  const timeoutMs = Math.max(250, Math.min(5_000, Math.floor(options.timeoutMs ?? 1_500)));
  const results = await Promise.all(Array.from({ length: attempts }, () => pingTeamSpeakPort(target, timeoutMs)));
  const samples = results
    .filter((result): result is TeamSpeakPingAttempt & { latencyMs: number } => result.ok && result.latencyMs !== null)
    .map((result) => result.latencyMs)
    .sort((left, right) => left - right);
  const errorCode = results.find((result) => result.errorCode)?.errorCode;

  return {
    ok: samples.length > 0,
    latencyMs: samples.length ? samples[Math.floor(samples.length / 2)] : null,
    packetLossPercent: Math.round(((attempts - samples.length) / attempts) * 100),
    attempts,
    successfulAttempts: samples.length,
    samples,
    ...(errorCode ? { errorCode } : {}),
  };
}
