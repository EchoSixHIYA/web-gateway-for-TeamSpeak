export type TeamSpeakPingErrorCode =
  | "HOST_NOT_FOUND"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "INVALID_PASSWORD"
  | "PROTOCOL_NEGOTIATION_FAILED"
  | "SERVER_REJECTED"
  | "INTERNAL_ERROR";

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

export type TeamSpeakCommandExecutor = (command: string, timeoutMs?: number) => Promise<unknown>;

/**
 * Measure an already connected TeamSpeak session using the protocol's own
 * command channel. TeamSpeak voice/query traffic is UDP; a TCP connect to
 * port 9987 is therefore not a valid reachability test and reports false
 * packet loss even while voice works normally.
 */
export async function pingTeamSpeakSession(
  execute: TeamSpeakCommandExecutor,
  timeoutMs = 1_500,
): Promise<TeamSpeakPingAttempt> {
  const startedAt = Date.now();
  try {
    // `version` is read-only and is handled by both TS3 and TS6.
    await execute("version", timeoutMs);
    return { ok: true, latencyMs: Math.max(0, Date.now() - startedAt) };
  } catch (error: unknown) {
    return {
      ok: false,
      latencyMs: null,
      errorCode: classifyProbeError(error),
    };
  }
}

export async function collectTeamSpeakPings(
  probe: () => Promise<TeamSpeakPingAttempt>,
  options: { attempts?: number } = {},
): Promise<TeamSpeakPingResult> {
  const attempts = Math.max(1, Math.min(8, Math.floor(options.attempts ?? 4)));
  const results: TeamSpeakPingAttempt[] = [];
  // Keep attempts sequential. This measures the real protocol path without
  // opening several temporary TeamSpeak sessions at the same time.
  for (let index = 0; index < attempts; index += 1) {
    results.push(await probe());
  }
  return summarizeTeamSpeakPings(results, attempts);
}

export function summarizeTeamSpeakPings(results: TeamSpeakPingAttempt[], attempts = results.length): TeamSpeakPingResult {
  const normalizedAttempts = Math.max(1, attempts);
  const samples = results
    .filter((result): result is TeamSpeakPingAttempt & { latencyMs: number } => result.ok && result.latencyMs !== null)
    .map((result) => result.latencyMs)
    .sort((left, right) => left - right);
  const errorCode = results.find((result) => result.errorCode)?.errorCode;

  return {
    ok: samples.length > 0,
    latencyMs: samples.length ? samples[Math.floor(samples.length / 2)] : null,
    packetLossPercent: Math.round(((normalizedAttempts - samples.length) / normalizedAttempts) * 100),
    attempts: normalizedAttempts,
    successfulAttempts: samples.length,
    samples,
    ...(errorCode ? { errorCode } : {}),
  };
}

function classifyProbeError(error: unknown): TeamSpeakPingErrorCode {
  const text = error instanceof Error ? error.message : String(error);
  const lower = text.toLocaleLowerCase();
  if (/enotfound|eai_again|getaddrinfo|host not found/.test(lower)) return "HOST_NOT_FOUND";
  if (/timeout|timed out|packet ack timeout|idle timeout/.test(lower)) return "TIMEOUT";
  if (/password|authentication|invalid.*credential/.test(lower)) return "INVALID_PASSWORD";
  if (/protocol|version|handshake|negotiat/.test(lower)) return "PROTOCOL_NEGOTIATION_FAILED";
  if (/reject|full|denied/.test(lower)) return "SERVER_REJECTED";
  return "UNREACHABLE";
}

/**
 * Keep a small compatibility helper for callers that only need one protocol
 * attempt. It deliberately has no host/port argument because the connected
 * TeamSpeak session owns the actual resolved endpoint.
 */
export function pingTeamSpeakPort(
  execute: TeamSpeakCommandExecutor,
  timeoutMs = 1_500,
): Promise<TeamSpeakPingAttempt> {
  return pingTeamSpeakSession(execute, timeoutMs);
}

/*
 * This function used to open a raw TCP socket to the TeamSpeak voice port.
 * That transport is not TeamSpeak's client protocol and must not be used for
 * reachability measurements. Keep the aggregation logic above independent of
 * the connection setup so admin tests can supply a real protocol probe.
 */
export async function pingTeamSpeak(
  probe: () => Promise<TeamSpeakPingAttempt>,
  options: { attempts?: number } = {},
): Promise<TeamSpeakPingResult> {
  return collectTeamSpeakPings(probe, options);
}
