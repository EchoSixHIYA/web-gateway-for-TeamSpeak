export interface ClientCommand {
  type: "switchChannel" | "sendTextMessage" | "sendServerMessage" | "sendPrivateMessage" | "poke" | "setAway" | "setWhisperTargets" | "setWhisperActive" | "setMicrophoneMuted" | "setAccompanimentActive" | "setMemberVolume" | "latencyProbe";
  requestId?: string;
  payload: Record<string, unknown>;
}

export type ClientCommandResult = ClientCommand | { error: { code: string; message: string } };

export function parseClientCommand(raw: string): ClientCommandResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: { code: "INVALID_JSON", message: "消息不是有效的 JSON" } };
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return { error: { code: "INVALID_MESSAGE", message: "消息类型不能为空" } };
  }
  if (value.requestId !== undefined && (typeof value.requestId !== "string" || value.requestId.length > 64)) {
    return { error: { code: "INVALID_REQUEST_ID", message: "请求标识无效" } };
  }
  const supportedTypes = new Set(["switchChannel", "sendTextMessage", "sendServerMessage", "sendPrivateMessage", "poke", "setAway", "setWhisperTargets", "setWhisperActive", "setMicrophoneMuted", "setAccompanimentActive", "setMemberVolume", "latencyProbe"]);
  if (!supportedTypes.has(value.type)) {
    return { error: { code: "UNKNOWN_MESSAGE_TYPE", message: "不支持的消息类型" } };
  }
  if (!isRecord(value.payload)) {
    return { error: { code: "INVALID_PAYLOAD", message: "消息参数无效" } };
  }
  if (value.type === "switchChannel" && (typeof value.payload.channelId !== "string" || !/^\d{1,20}$/.test(value.payload.channelId))) {
    return { error: { code: "INVALID_CHANNEL_ID", message: "频道标识无效" } };
  }
  if (value.type === "switchChannel" && value.payload.password !== undefined && (typeof value.payload.password !== "string" || value.payload.password.length > 512)) {
    return { error: { code: "INVALID_CHANNEL_PASSWORD", message: "频道密码无效" } };
  }
  if (value.type === "sendTextMessage" && (typeof value.payload.message !== "string" || value.payload.message.length > 500)) {
    return { error: { code: "INVALID_TEXT_MESSAGE", message: "文字消息无效" } };
  }
  if ((value.type === "sendServerMessage" || value.type === "sendPrivateMessage") && (typeof value.payload.message !== "string" || value.payload.message.length > 500)) {
    return { error: { code: "INVALID_TEXT_MESSAGE", message: "文字消息无效" } };
  }
  if ((value.type === "sendPrivateMessage" || value.type === "poke") && (typeof value.payload.clientId !== "number" || !Number.isInteger(value.payload.clientId) || value.payload.clientId <= 0 || value.payload.clientId > 65535)) {
    return { error: { code: "INVALID_CLIENT_ID", message: "成员标识无效" } };
  }
  if (value.type === "poke" && (typeof value.payload.message !== "string" || value.payload.message.length > 200)) {
    return { error: { code: "INVALID_POKE_MESSAGE", message: "戳一戳消息无效" } };
  }
  if (value.type === "setAway" && (typeof value.payload.away !== "boolean" || (value.payload.message !== undefined && (typeof value.payload.message !== "string" || value.payload.message.length > 200)))) {
    return { error: { code: "INVALID_AWAY_STATUS", message: "离开状态无效" } };
  }
  if (value.type === "setWhisperTargets") {
    const targetIds = value.payload.targetIds;
    if (!Array.isArray(targetIds) || targetIds.length > 8 || targetIds.some((clientId) => typeof clientId !== "number" || !Number.isInteger(clientId) || clientId <= 0 || clientId > 65535) || new Set(targetIds).size !== targetIds.length) {
      return { error: { code: "INVALID_WHISPER_TARGETS", message: "私语目标无效" } };
    }
  }
  if (value.type === "setWhisperActive" && typeof value.payload.active !== "boolean") {
    return { error: { code: "INVALID_WHISPER_STATE", message: "私语状态无效" } };
  }
  if (value.type === "setMicrophoneMuted" && typeof value.payload.muted !== "boolean") {
    return { error: { code: "INVALID_MICROPHONE_STATE", message: "麦克风状态无效" } };
  }
  if (value.type === "setAccompanimentActive" && typeof value.payload.active !== "boolean") {
    return { error: { code: "INVALID_ACCOMPANIMENT_STATE", message: "伴奏状态无效" } };
  }
  if (value.type === "setMemberVolume" && (typeof value.payload.clientId !== "number" || !Number.isInteger(value.payload.clientId) || value.payload.clientId <= 0 || value.payload.clientId > 65535 || typeof value.payload.volume !== "number" || !Number.isFinite(value.payload.volume) || value.payload.volume < 0 || value.payload.volume > 4)) {
    return { error: { code: "INVALID_MEMBER_VOLUME", message: "成员音量无效" } };
  }
  if (value.type === "latencyProbe" && (typeof value.payload.sequence !== "string" || value.payload.sequence.length > 64)) {
    return { error: { code: "INVALID_LATENCY_PROBE", message: "延迟探测标识无效" } };
  }
  return {
    type: value.type as ClientCommand["type"],
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    payload: value.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
