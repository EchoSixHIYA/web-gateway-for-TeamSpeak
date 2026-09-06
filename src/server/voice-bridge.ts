import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { createRequire } from "node:module";
import { identityFromString } from "@echosixhiya/teamspeak-client";
import { DirectorySynchronizer } from "./directory-sync.js";
import { TSClient, type TSDirectorySnapshot, type TSVoiceData } from "./ts-client.js";
import type { Logger as LoggerType } from "../logger.js";
import { normalizeTeamSpeakError } from "../errors.js";
import { formatTeamSpeakTarget, teamSpeakTargetKey, type TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { JoinTicketStore, type JoinTicketPayload } from "./join-ticket.js";
import { IdentityLeaseStore } from "./identity-lease.js";
import { SessionManager, type ManagedSession, type SessionTeardownReason } from "./session-manager.js";
import { parseClientCommand, type ClientCommand } from "./voice-protocol.js";
import { isRecoverable, reconnectDelayMs, reconnectWindowOpen } from "./reconnect-policy.js";
import { WebRtcAudioSession, type WebRtcAudioOptions, type WebRtcAudioStats, type WebRtcSessionDescription } from "./webrtc-audio.js";
import { pingTeamSpeakPort } from "./network-probe.js";

const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus") as {
  OpusEncoder: new (sampleRate: number, channels: number) => { encode(pcm: Buffer): Buffer };
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const AUDIO_FRAME_BYTES = 1_920;
// A browser audio frame is 20 ms of mono 48 kHz PCM. Keep the server-side
// WebSocket egress queue small enough that a slow browser cannot turn old
// voice into seconds of latency. Opus frames are variable-sized, so this is
// deliberately a conservative byte backpressure guard for roughly 10–20
// small Opus frames; the browser also enforces a time-based playback limit
// before scheduling decoded audio.
const MAX_SERVER_AUDIO_BUFFERED_BYTES = 4_096;

export interface VoiceBridgeOptions {
  joinTickets: JoinTicketStore;
  webRtc?: WebRtcAudioOptions | (() => WebRtcAudioOptions);
}

export interface AdminSessionSummary {
  id: string;
  nickname: string;
  target: string;
  state: string;
  createdAt: string;
  ageSeconds: number;
  tsClientId: number | null;
  channelId: string | null;
  memberCount: number;
  audio: AudioFlowStats;
}

export interface AudioFlowStats {
  ingressFrames: number;
  ingressDroppedFrames: number;
  ingressFirstAt: number | null;
  ingressLastAt: number | null;
  ingressMaxGapMs: number;
  tsSendFrames: number;
  tsSendErrors: number;
  tsSendFirstAt: number | null;
  tsSendLastAt: number | null;
  tsSendMaxGapMs: number;
  tsEncodeMaxMs: number;
  tsReceiveFrames: number;
  tsReceiveFirstAt: number | null;
  tsReceiveLastAt: number | null;
  tsReceiveMaxGapMs: number;
  egressFrames: number;
  egressDroppedFrames: number;
  egressFirstAt: number | null;
  egressLastAt: number | null;
  egressMaxGapMs: number;
  egressSentFirstAt: number | null;
  egressSentLastAt: number | null;
  egressSentMaxGapMs: number;
  egressPeakBufferedBytes: number;
  egressFramesByClient: Record<string, number>;
  webrtcIngressRtpFrames: number;
  webrtcIngressRtpFirstAt: number | null;
  webrtcIngressRtpLastAt: number | null;
  webrtcIngressRtpMaxGapMs: number;
  webrtcEgressRtpFrames: number;
  webrtcEgressRtpFirstAt: number | null;
  webrtcEgressRtpLastAt: number | null;
  webrtcEgressRtpMaxGapMs: number;
  webrtcQueuePeakFrames: number;
  webrtcQueueDroppedFrames: number;
  webrtcQueueUnderrunTicks: number;
  webrtcPacerLateTicks: number;
  webrtcQueueCurrentFrames: number;
  webrtcIngressQuietFrames: number;
  webrtcIngressDecodeErrors: number;
  webrtcDownlinkDecodedFrames: number;
  webrtcDownlinkDecodeErrors: number;
  webrtcDownlinkShortFrames: number;
}

interface ChannelMember {
  id: number;
  nickname: string;
  uid: string;
  away?: boolean;
  awayMessage?: string;
  inputMuted?: boolean;
  outputMuted?: boolean;
  channelCommander?: boolean;
}

interface ServerEvent {
  id: string;
  kind: "joined" | "left" | "moved" | "poke" | "connection";
  message: string;
  timestamp: number;
}

interface WebClientEntry {
  id: string;
  session: ManagedSession;
  tsClient: TSClient;
  ws: WebSocket;
  nickname: string;
  rememberIdentity: boolean;
  target: TeamSpeakTarget;
  identityLeaseKey?: string;
  webrtcPublicHost?: string;
  channelTree: unknown[];
  members: Map<number, ChannelMember>;
  eventLog: ServerEvent[];
  opusEncoder: { encode(pcm: Buffer): Buffer } | null;
  whisperTargetIds: Set<number>;
  whisperActive: boolean;
  isAlive: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  audio: AudioFlowStats;
  webrtc: WebRtcAudioSession | null;
  lastLatencyProbeAt: number;
}

export class VoiceBridge {
  private readonly sessionManager = new SessionManager();
  private readonly entries = new Map<string, WebClientEntry>();
  private readonly identityLeases = new IdentityLeaseStore();
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logger: LoggerType;

  constructor(
    private options: VoiceBridgeOptions,
    logger: LoggerType,
  ) {
    this.logger = logger.child({ component: "voice-bridge" });
  }

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws/voice", maxPayload: 256 * 1024 });
    this.startHeartbeat();

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
      const connection = this.resolveConnection(url);
      if (!connection) {
        ws.close(4001, "Join ticket required");
        return;
      }

      const { target, serverPassword, nickname } = connection;
      const channelName = connection.channel;
      const webrtcPublicHost = resolveWebRtcPublicHost(req);
      let identity;
      try {
        identity = connection.identity ? identityFromString(connection.identity) : undefined;
      } catch {
        ws.close(4003, "Invalid identity");
        return;
      }
      const entryId = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      let entry: WebClientEntry | null = null;
      const session = this.sessionManager.admit(entryId, async (reason) => {
        if (entry) await this.cleanupEntry(entry, reason);
      });
      if (!session) {
        this.logger.warn({ max: this.sessionManager.maxSessions }, "Max clients reached");
        ws.close(4004, "GATEWAY_FULL");
        return;
      }

      const identityLeaseKey = identity
        ? `${teamSpeakTargetKey(target)}:${identity.toString()}`
        : "";
      if (identityLeaseKey && !this.identityLeases.acquire(identityLeaseKey, entryId)) {
        this.logger.warn({ entryId, nickname, target: formatTeamSpeakTarget(target) }, "TeamSpeak identity already in use");
        void this.sessionManager.teardown(entryId, "teamSpeak-connect-failed");
        ws.close(4005, "IDENTITY_IN_USE");
        return;
      }

      this.logger.info({ entryId, nickname, channel: channelName, target: formatTeamSpeakTarget(target) }, "WebClient connecting");
      let tsClient: TSClient;
      try {
        tsClient = new TSClient({ target, nickname, serverPassword, defaultChannel: channelName, identity }, this.logger);
      } catch (error: unknown) {
        if (identityLeaseKey) this.identityLeases.release(identityLeaseKey, entryId);
        this.logger.error({ err: error, entryId }, "Could not create TeamSpeak client");
        void this.sessionManager.teardown(entryId, "teamSpeak-connect-failed");
        ws.close(4003, "TeamSpeak client unavailable");
        return;
      }
      entry = {
        id: entryId,
        session,
        tsClient,
        ws,
        nickname,
        rememberIdentity: connection.rememberIdentity === true,
        target,
        ...(identityLeaseKey ? { identityLeaseKey } : {}),
        ...(webrtcPublicHost ? { webrtcPublicHost } : {}),
        channelTree: [],
        members: new Map(),
        eventLog: [],
        opusEncoder: null,
        whisperTargetIds: new Set(),
        whisperActive: false,
        isAlive: true,
        reconnectTimer: null,
        audio: createAudioFlowStats(),
        webrtc: null,
        lastLatencyProbeAt: 0,
      };
      this.entries.set(entryId, entry!);
      try {
        entry!.opusEncoder = new OpusEncoder(48000, 1);
      } catch (error: unknown) {
        this.logger.error({ err: error, entryId }, "Could not create Opus encoder");
        void this.teardown(entryId, "teamSpeak-connect-failed");
        return;
      }

      let tsReady = false;
      let selfId = 0;
      let selfChannelId = 0n;
      let initialStateSent = false;
      let audioReady = true;
      let realtimeReady = false;
      let hasConnectedOnce = false;
      let reconnectStartedAt = 0;
      let reconnectAttempt = 0;
      const directory = new DirectorySynchronizer();

      const sendJson = (message: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };
      const addServerEvent = (kind: ServerEvent["kind"], message: string) => {
        const event: ServerEvent = {
          id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          message,
          timestamp: Date.now(),
        };
        entry!.eventLog.push(event);
        if (entry!.eventLog.length > 200) entry!.eventLog.splice(0, entry!.eventLog.length - 200);
        if (initialStateSent) sendJson({ type: "serverEvent", event });
      };
      const refreshDirectory = () => {
        const snapshot = directory.getSnapshot();
        if (!snapshot) return;
        const previousWhisperTargets = [...entry!.whisperTargetIds].sort((a, b) => a - b);
        const effectiveSelfId = selfId || tsClient.getClientId();
        const sdkChannelId = tsClient.getChannelId();
        if (selfChannelId === 0n && sdkChannelId !== 0n) selfChannelId = sdkChannelId;
        const normalizedSnapshot = normalizeDirectorySnapshot(snapshot, effectiveSelfId, selfChannelId, nickname, channelName);
        entry!.channelTree = mapChannelTree(normalizedSnapshot);
        entry!.members.clear();
        for (const client of normalizedSnapshot.clients) {
          entry!.members.set(client.id, {
            id: client.id,
            nickname: client.nickname,
            uid: client.uid,
            away: client.away,
            awayMessage: client.awayMessage,
            inputMuted: client.inputMuted,
            outputMuted: client.outputMuted,
            channelCommander: client.channelCommander,
          });
        }
        for (const clientId of entry!.whisperTargetIds) {
          if (!entry!.members.has(clientId) || clientId === effectiveSelfId) entry!.whisperTargetIds.delete(clientId);
        }
        if (!entry!.whisperTargetIds.size) entry!.whisperActive = false;
        const nextWhisperTargets = [...entry!.whisperTargetIds].sort((a, b) => a - b);
        if (initialStateSent && (previousWhisperTargets.length !== nextWhisperTargets.length || previousWhisperTargets.some((clientId, index) => clientId !== nextWhisperTargets[index]))) {
          sendJson({ type: "whisperTargets", targetIds: nextWhisperTargets, active: entry!.whisperActive });
        }
      };
      const trackChannelEvents = (previous: unknown[], next: unknown[]) => {
        if (!initialStateSent) return;
        const before = new Map(previous.filter(isChannelRecord).map((channel) => [channel.id, channel]));
        const after = new Map(next.filter(isChannelRecord).map((channel) => [channel.id, channel]));
        for (const channel of after.values()) {
          if (!before.has(channel.id)) addServerEvent("joined", `频道「${channel.name}」已创建`);
          else if (before.get(channel.id)?.name !== channel.name) addServerEvent("moved", `频道已重命名为「${channel.name}」`);
        }
        for (const channel of before.values()) if (!after.has(channel.id)) addServerEvent("left", `频道「${channel.name}」已删除`);
      };
      const sendInitialState = () => {
        if (initialStateSent || !tsReady || !directory.ready || !realtimeReady || !audioReady || session.state !== "syncing") return;
        initialStateSent = true;
        const wasReconnecting = hasConnectedOnce;
        hasConnectedOnce = true;
        reconnectAttempt = 0;
        reconnectStartedAt = 0;
        if (!wasReconnecting) {
          entry!.eventLog.push({ id: `event-${Date.now().toString(36)}-connected`, kind: "connection", message: "已连接到服务器", timestamp: Date.now() });
          this.logger.info({ entryId: entry!.id, nickname: entry!.nickname, target: formatTeamSpeakTarget(entry!.target) }, "Web client connected to TeamSpeak");
        }
        session.transition("connected");
        sendJson({
          type: "connected",
          tsClientId: selfId,
          members: Array.from(entry!.members.values()),
          serverEventLog: entry!.eventLog,
          whisperTargetIds: [...entry!.whisperTargetIds],
          whisperActive: entry!.whisperActive,
          webrtcAvailable: this.getWebRtcOptions()?.enabled === true,
          ...(entry!.rememberIdentity ? { identity: tsClient.getIdentityString() } : {}),
        });
        sendJson({ type: "channelList", channels: entry!.channelTree });
        if (wasReconnecting) sendJson({ type: "reconnected" });
      };

      const resetDirectoryForReconnect = () => {
        tsReady = false;
        initialStateSent = false;
        selfId = 0;
        selfChannelId = 0n;
        directory.clear();
        entry!.channelTree = [];
        entry!.members.clear();
        entry!.whisperTargetIds.clear();
        entry!.whisperActive = false;
      };

      const failReconnect = (normalized: ReturnType<typeof normalizeTeamSpeakError>) => {
        if (entry!.reconnectTimer) {
          clearTimeout(entry!.reconnectTimer);
          entry!.reconnectTimer = null;
        }
        try {
          if (session.state !== "disconnecting" && session.state !== "idle") session.transition("failed");
        } catch { /* teardown below remains authoritative */ }
        sendJson({ type: "reconnectFailed", code: normalized.code });
        void this.teardown(entryId, "teamSpeak-connect-failed");
      };

      const scheduleReconnect = (normalized: ReturnType<typeof normalizeTeamSpeakError> | null) => {
        if (session.state === "disconnecting" || session.state === "idle" || session.state === "failed") return;
        if (!isRecoverable(normalized)) {
          failReconnect(normalized ?? normalizeTeamSpeakError(new Error("TeamSpeak connection failed")));
          return;
        }
        const now = Date.now();
        if (!reconnectStartedAt) reconnectStartedAt = now;
        reconnectAttempt += 1;
        if (!reconnectWindowOpen(reconnectStartedAt, now)) {
          failReconnect(normalized ?? normalizeTeamSpeakError(new Error("Reconnect window expired")));
          return;
        }
        if (session.state === "connected") session.transition("interrupted");
        if (session.state === "interrupted") session.transition("reconnecting");
        if (entry!.reconnectTimer) return;
        const delayMs = reconnectDelayMs(reconnectAttempt);
        sendJson({ type: "reconnecting", attempt: reconnectAttempt, delayMs });
        entry!.reconnectTimer = setTimeout(() => {
          entry!.reconnectTimer = null;
          if (session.state !== "reconnecting") return;
          try {
            session.transition("connecting");
            session.transition("authenticating");
          } catch {
            failReconnect(normalizeTeamSpeakError(new Error("Reconnect state initialization failed")));
            return;
          }
          void connectTeamSpeak(true);
        }, delayMs);
        entry!.reconnectTimer.unref?.();
      };

      const connectTeamSpeak = async (isReconnect: boolean): Promise<void> => {
        try {
          await tsClient.connect();
          if (session.state !== "authenticating") return;
          session.transition("syncing");
          tsReady = true;
          selfId = tsClient.getClientId();
          const sdkChannelId = tsClient.getChannelId();
          if (sdkChannelId !== 0n) selfChannelId = sdkChannelId;
          refreshDirectory();
          if (selfId > 0 && !entry!.members.has(selfId)) {
            directory.applyClientEnter({ id: selfId, nickname, channelID: selfChannelId, uid: "", type: 1, serverGroups: [] });
            refreshDirectory();
          }
          sendInitialState();
        } catch (error: unknown) {
          const normalized = normalizeTeamSpeakError(error);
          this.logger.error({ code: normalized.code, entryId, reconnect: isReconnect, attempt: reconnectAttempt }, "TS connect failed");
          if (!isReconnect) {
            try {
              if (session.state !== "disconnecting" && session.state !== "idle") session.transition("failed");
            } catch { /* teardown below remains authoritative */ }
            if (ws.readyState === WebSocket.OPEN) ws.close(4003, normalized.code);
            void this.teardown(entryId, "teamSpeak-connect-failed");
            return;
          }
          if (isReconnect && isRecoverable(normalized)) {
            try {
              if (session.state !== "disconnecting" && session.state !== "idle") session.transition("reconnecting");
            } catch { /* teardown below remains authoritative */ }
            scheduleReconnect(normalized);
            return;
          }
          failReconnect(normalized);
        }
      };

      // Register every directory listener before connect(). Events emitted by
      // the welcome flow are queued by DirectorySynchronizer until its
      // snapshot establishes the baseline.
      realtimeReady = true;
      tsClient.on("directorySnapshot", (snapshot: TSDirectorySnapshot) => {
        const previousChannels = entry!.channelTree;
        directory.applySnapshot(snapshot);
        refreshDirectory();
        trackChannelEvents(previousChannels, entry!.channelTree);
        sendInitialState();
        if (tsReady && initialStateSent) sendJson({ type: "channelList", channels: entry!.channelTree });
      });

      tsClient.on("clientEnter", (info) => {
        const candidateSelfId = tsClient.getClientId();
        if (candidateSelfId > 0 && info.id === candidateSelfId) {
          selfId = candidateSelfId;
          if (info.channelID !== undefined && info.channelID !== 0n) selfChannelId = info.channelID;
        }
        const wasKnown = entry!.members.has(info.id);
        directory.applyClientEnter(info);
        refreshDirectory();
        if (tsReady && initialStateSent) {
          sendJson({ type: "channelList", channels: entry!.channelTree });
          if (!wasKnown) sendJson({ type: "memberEnter", id: info.id, nickname: info.nickname, uid: info.uid, isSelf: info.id === selfId });
          if (!wasKnown && info.id !== selfId) addServerEvent("joined", `${info.nickname || "未知用户"} 加入了服务器`);
        }
      });

      tsClient.on("clientLeave", (info) => {
        const wasKnown = entry!.members.has(info.id);
        const leavingMember = entry!.members.get(info.id);
        entry!.webrtc?.setMemberVolume(info.id, 1);
        directory.applyClientLeave(info.id);
        refreshDirectory();
        if (tsReady && initialStateSent && wasKnown) {
          sendJson({ type: "memberLeave", id: info.id });
          sendJson({ type: "channelList", channels: entry!.channelTree });
          if (info.id !== selfId) addServerEvent("left", `${leavingMember?.nickname || "用户"} 离开了服务器`);
        }
      });

      tsClient.on("clientMoved", (info) => {
        if (info.targetChannelID === undefined || info.targetChannelID === 0n) return;
        const movedMember = entry!.members.get(info.id);
        if (info.id === selfId) selfChannelId = info.targetChannelID;
        directory.applyClientMoved(info.id, info.targetChannelID);
        refreshDirectory();
        if (tsReady && initialStateSent) {
          sendJson({ type: "channelList", channels: entry!.channelTree });
          if (info.id !== selfId) addServerEvent("moved", `${movedMember?.nickname || "用户"} 移动到了其他频道`);
        }
      });

      tsClient.on("voiceData", (data: TSVoiceData) => {
        const receivedAt = Date.now();
        if (entry!.audio.tsReceiveLastAt !== null) entry!.audio.tsReceiveMaxGapMs = Math.max(entry!.audio.tsReceiveMaxGapMs, receivedAt - entry!.audio.tsReceiveLastAt);
        entry!.audio.tsReceiveFirstAt ??= receivedAt;
        entry!.audio.tsReceiveLastAt = receivedAt;
        entry!.audio.tsReceiveFrames++;
        if (ws.readyState !== WebSocket.OPEN || data.clientId === selfId) return;
        const webRtc = entry!.webrtc;
        webRtc?.pushTeamSpeakVoice(data);
        const now = receivedAt;
        if (entry!.audio.egressLastAt !== null) entry!.audio.egressMaxGapMs = Math.max(entry!.audio.egressMaxGapMs, now - entry!.audio.egressLastAt);
        entry!.audio.egressFirstAt ??= now;
        entry!.audio.egressLastAt = now;
        const sourceKey = String(data.clientId);
        entry!.audio.egressFramesByClient[sourceKey] = (entry!.audio.egressFramesByClient[sourceKey] ?? 0) + 1;
        // A negotiated WebRTC session owns the browser's realtime audio
        // egress. Do not also send the same TeamSpeak packet over the
        // reliable WebSocket, otherwise the browser plays two copies and
        // the TCP path can still accumulate stale audio behind the peer.
        if (webRtc) {
          entry!.audio.egressFrames++;
          return;
        }
        const packet = Buffer.allocUnsafe(3 + data.data.length);
        packet[0] = data.codec;
        packet.writeUInt16BE(data.clientId, 1);
        data.data.copy(packet, 3);
        const bufferedBytes = ws.bufferedAmount;
        entry!.audio.egressPeakBufferedBytes = Math.max(entry!.audio.egressPeakBufferedBytes, bufferedBytes);
        if (bufferedBytes > MAX_SERVER_AUDIO_BUFFERED_BYTES) {
          entry!.audio.egressDroppedFrames++;
          return;
        }
        try {
          ws.send(packet);
          entry!.audio.egressFrames++;
          const sentAt = Date.now();
          if (entry!.audio.egressSentLastAt !== null) entry!.audio.egressSentMaxGapMs = Math.max(entry!.audio.egressSentMaxGapMs, sentAt - entry!.audio.egressSentLastAt);
          entry!.audio.egressSentFirstAt ??= sentAt;
          entry!.audio.egressSentLastAt = sentAt;
        } catch {
          entry!.audio.egressDroppedFrames++;
        }
      });

      tsClient.on("textMessage", (message) => {
        const scope = message.targetMode === 1 ? "private" : message.targetMode === 3 ? "server" : message.targetMode === 2 ? "channel" : "server";
        const targetId = message.targetId ?? 0n;
        // TeamSpeak channel notifications omit `target`; the SDK represents
        // that as 0. Bind the broadcast to this session's current channel so
        // it remains visible now but cannot leak into another channel after a
        // later channel switch.
        const effectiveTargetId = scope === "channel" && targetId === 0n ? tsClient.getChannelId() : targetId;
        sendJson({
          type: "chatMessage",
          scope,
          ...(effectiveTargetId !== 0n ? { targetId: String(effectiveTargetId) } : {}),
          senderUid: message.invokerUid,
          timestamp: Date.now(),
          invokerName: message.invokerName,
          invokerId: message.invokerId,
          message: message.message,
        });
      });

      tsClient.on("poked", (event) => {
        sendJson({ type: "pokeReceived", invokerId: event.invokerID, invokerUid: event.invokerUID, invokerName: event.invokerName, message: event.message, timestamp: Date.now() });
        addServerEvent("poke", `${event.invokerName || "用户"} 戳了你一下`);
      });

      tsClient.on("disconnected", (error?: Error) => {
        if (!hasConnectedOnce || session.state !== "connected") return;
        resetDirectoryForReconnect();
        const normalized = error ? normalizeTeamSpeakError(error) : null;
        sendJson({ type: "disconnected", recoverable: isRecoverable(normalized) });
        scheduleReconnect(normalized);
      });

      ws.on("pong", () => { if (entry) entry.isAlive = true; });
      ws.on("message", (data: Buffer | string, isBinary: boolean) => {
        if (isBinary) {
          const frame = typeof data === "string" ? Buffer.from(data) : data;
          if (!tsReady || frame.length !== AUDIO_FRAME_BYTES) {
            entry!.audio.ingressDroppedFrames++;
            sendProtocolError(sendJson, "INVALID_AUDIO_FRAME", "音频帧格式无效");
            return;
          }
          const now = Date.now();
          if (entry!.audio.ingressLastAt !== null) entry!.audio.ingressMaxGapMs = Math.max(entry!.audio.ingressMaxGapMs, now - entry!.audio.ingressLastAt);
          entry!.audio.ingressFirstAt ??= now;
          entry!.audio.ingressLastAt = now;
          entry!.audio.ingressFrames++;
          const encodeStartedAt = Date.now();
          try {
            if (entry!.opusEncoder) {
              const encoded = entry!.opusEncoder.encode(frame);
              const encodedAt = Date.now();
              entry!.audio.tsEncodeMaxMs = Math.max(entry!.audio.tsEncodeMaxMs, encodedAt - encodeStartedAt);
              if (entry!.whisperActive && entry!.whisperTargetIds.size) tsClient.sendWhisper(encoded, [...entry!.whisperTargetIds], 4);
              else tsClient.sendVoice(encoded, 4);
              const sentAt = Date.now();
              if (entry!.audio.tsSendLastAt !== null) entry!.audio.tsSendMaxGapMs = Math.max(entry!.audio.tsSendMaxGapMs, sentAt - entry!.audio.tsSendLastAt);
              entry!.audio.tsSendFirstAt ??= sentAt;
              entry!.audio.tsSendLastAt = sentAt;
              entry!.audio.tsSendFrames++;
            }
          } catch {
            // A frame arriving during shutdown is safe to discard.
            entry!.audio.tsSendErrors++;
          }
          return;
        }

        const rawMessage = typeof data === "string" ? data : data.toString("utf-8");
        const webRtcOffer = parseWebRtcOffer(rawMessage);
        if (webRtcOffer) {
          if (this.getWebRtcOptions()?.enabled !== true) {
            sendProtocolError(sendJson, "WEBRTC_DISABLED", "WebRTC 音频传输未启用");
            return;
          }
          if (!tsReady || session.state !== "connected") {
            sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪");
            return;
          }
          void this.handleWebRtcOffer(entry!, webRtcOffer, sendJson);
          return;
        }
        if (isWebRtcStopMessage(rawMessage)) {
          const webRtc = entry!.webrtc;
          entry!.webrtc = null;
          if (webRtc) {
            void webRtc.close()
              .then(() => Object.assign(entry!.audio, webRtc.getStats()))
              .catch(() => undefined);
          }
          return;
        }
        const command = parseClientCommand(rawMessage);
        if ("error" in command) {
          sendProtocolError(sendJson, command.error.code, command.error.message);
          return;
        }
        if (!tsReady || session.state !== "connected") {
          sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪");
          return;
        }
        void handleCommand(entry!, command, sendJson);
      });

      ws.on("close", () => {
        this.logger.info({ entryId }, "WebSocket closed");
        void this.teardown(entryId, "websocket-close");
      });

      ws.on("error", (error) => {
        this.logger.error({ err: error, entryId }, "WebSocket error");
        void this.teardown(entryId, "websocket-error");
      });

      try {
        session.transition("connecting");
        session.transition("authenticating");
      } catch (error: unknown) {
        this.logger.error({ err: error instanceof Error ? error.message : String(error), entryId }, "Session state initialization failed");
        void this.teardown(entryId, "protocol-error");
        return;
      }

      void connectTeamSpeak(false);
    });

    this.wss.on("error", (error) => {
      this.logger.error({ err: error }, "Voice WebSocket server error");
    });
    this.logger.info("Voice WebSocket endpoint ready at /ws/voice");
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.sessionManager.shutdown("gateway-shutdown");
    const wss = this.wss;
    this.wss = null;
    if (!wss) return;
    await new Promise<void>((resolve) => {
      try { wss.close(() => resolve()); } catch { resolve(); }
    });
  }

  getActiveCount(): number {
    return this.sessionManager.activeCount;
  }

  getPeakCount(): number {
    return this.sessionManager.peakCount;
  }

  getCreatedCount(): number {
    return this.sessionManager.createdCount;
  }

  getSessionSummaries(): AdminSessionSummary[] {
    const now = Date.now();
    return [...this.entries.values()]
      .sort((left, right) => left.session.createdAt - right.session.createdAt)
      .map((entry) => {
        let tsClientId: number | null = null;
        let channelId: string | null = null;
        try { tsClientId = entry.tsClient.getClientId() || null; } catch { /* still connecting */ }
        try {
          const id = entry.tsClient.getChannelId();
          channelId = id === 0n ? null : id.toString();
        } catch { /* still connecting */ }
        return {
          id: entry.id,
          nickname: entry.nickname,
          target: formatTeamSpeakTarget(entry.target),
          state: entry.session.state,
          createdAt: new Date(entry.session.createdAt).toISOString(),
          ageSeconds: Math.max(0, Math.floor((now - entry.session.createdAt) / 1000)),
          tsClientId,
          channelId,
          memberCount: entry.members.size,
          audio: snapshotAudioStats(entry),
        };
      });
  }

  async terminateSession(entryId: string): Promise<boolean> {
    if (!this.entries.has(entryId)) return false;
    await this.sessionManager.teardown(entryId, "admin-terminated");
    return true;
  }

  private async teardown(entryId: string, reason: SessionTeardownReason): Promise<void> {
    await this.sessionManager.teardown(entryId, reason);
  }

  private async cleanupEntry(entry: WebClientEntry, reason: SessionTeardownReason): Promise<void> {
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    entry.opusEncoder = null;
    const webRtc = entry.webrtc;
    entry.webrtc = null;
    if (webRtc) {
      try { await webRtc.close(); } catch { /* peer teardown is idempotent */ }
      Object.assign(entry.audio, webRtc.getStats());
    }
    entry.whisperTargetIds.clear();
    entry.whisperActive = false;
    entry.channelTree = [];
    entry.members.clear();
    entry.tsClient.removeAllListeners();
    try { await entry.tsClient.disconnect(); } catch { /* disconnect is intentionally idempotent */ }
    entry.ws.removeAllListeners();
    if (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING) {
      if (reason === "heartbeat-timeout" || reason === "gateway-shutdown") entry.ws.terminate();
      else entry.ws.close(reason === "protocol-error" ? 1008 : 1000, reason);
    }
    if (entry.identityLeaseKey) this.identityLeases.release(entry.identityLeaseKey, entry.id);
    this.logger.info({
      entryId: entry.id,
      nickname: entry.nickname,
      target: formatTeamSpeakTarget(entry.target),
      reason,
      durationSeconds: Math.max(0, Math.floor((Date.now() - entry.session.createdAt) / 1000)),
      audio: { ...entry.audio },
    }, "Client session torn down");
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      for (const entry of this.entries.values()) {
        if (entry.ws.readyState !== WebSocket.OPEN) continue;
        if (!entry.isAlive) {
          entry.ws.terminate();
          void this.teardown(entry.id, "heartbeat-timeout");
          continue;
        }
        entry.isAlive = false;
        entry.ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private resolveConnection(url: URL): JoinTicketPayload | null {
    const token = url.searchParams.get("ticket");
    return token ? this.options.joinTickets.consume(token) : null;
  }

  private getWebRtcOptions(): WebRtcAudioOptions | undefined {
    const configured = this.options.webRtc;
    return typeof configured === "function" ? configured() : configured;
  }

  private async handleWebRtcOffer(
    entry: WebClientEntry,
    offer: WebRtcSessionDescription,
    sendJson: (message: Record<string, unknown>) => void,
  ): Promise<void> {
    if (entry.webrtc) {
      const previousWebRtc = entry.webrtc;
      try { await previousWebRtc.close(); } catch { /* replace a retried offer */ }
      Object.assign(entry.audio, previousWebRtc.getStats());
      entry.webrtc = null;
    }
    const config = this.getWebRtcOptions();
    if (!config?.enabled) return;
    const peer = new WebRtcAudioSession({
      connectionId: entry.id,
      ...(entry.webrtcPublicHost ? { publicHost: entry.webrtcPublicHost } : {}),
      udpPortRange: config.udpPortRange,
      logger: this.logger,
      microphoneMuted: offer.muted === true,
      accompanimentActive: offer.accompanimentActive === true,
      onVoiceFrame: (data, codec) => {
        const now = Date.now();
        if (entry.audio.ingressLastAt !== null) entry.audio.ingressMaxGapMs = Math.max(entry.audio.ingressMaxGapMs, now - entry.audio.ingressLastAt);
        entry.audio.ingressFirstAt ??= now;
        entry.audio.ingressLastAt = now;
        entry.audio.ingressFrames++;
        try {
          if (entry.whisperActive && entry.whisperTargetIds.size) entry.tsClient.sendWhisper(data, [...entry.whisperTargetIds], codec);
          else entry.tsClient.sendVoice(data, codec);
          const sentAt = Date.now();
          if (entry.audio.tsSendLastAt !== null) entry.audio.tsSendMaxGapMs = Math.max(entry.audio.tsSendMaxGapMs, sentAt - entry.audio.tsSendLastAt);
          entry.audio.tsSendFirstAt ??= sentAt;
          entry.audio.tsSendLastAt = sentAt;
          entry.audio.tsSendFrames++;
        } catch {
          entry.audio.tsSendErrors++;
          // A packet arriving while the TeamSpeak session is being replaced
          // is discarded; the WebRTC peer remains independently closable.
        }
      },
      onVoiceActivity: (clientIds) => {
        if (entry.ws.readyState === WebSocket.OPEN) sendJson({ type: "voiceActivity", clientIds });
      },
    });
    entry.webrtc = peer;
    try {
      const answer = await peer.createAnswer({ type: offer.type, sdp: offer.sdp });
      if (entry.webrtc !== peer || entry.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: "webrtcAnswer", payload: { sdp: answer } });
      this.logger.info({ entryId: entry.id }, "WebRTC audio negotiation completed");
    } catch (error: unknown) {
      if (entry.webrtc === peer) entry.webrtc = null;
      try { await peer.close(); } catch { /* best effort */ }
      this.logger.warn({ entryId: entry.id, err: error instanceof Error ? error.message : String(error) }, "WebRTC audio negotiation failed");
      if (entry.ws.readyState === WebSocket.OPEN) sendJson({ type: "webrtcError", code: "WEBRTC_NEGOTIATION_FAILED" });
    }
  }
}

function resolveWebRtcPublicHost(request: IncomingMessage): string | undefined {
  const origin = firstHeader(request.headers.origin);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const directHost = firstHeader(request.headers.host);
  for (const candidate of [origin, forwardedHost, directHost]) {
    const host = normalizeWebRtcHost(candidate);
    if (host) return host;
  }
  return undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeWebRtcHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.split(",", 1)[0]?.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return undefined;
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

async function handleCommand(
  entry: WebClientEntry,
  command: ClientCommand,
  sendJson: (message: Record<string, unknown>) => void,
): Promise<void> {
  if (command.type === "latencyProbe") {
    const sequence = command.payload.sequence as string;
    const now = Date.now();
    if (now - entry.lastLatencyProbeAt < 150) return;
    entry.lastLatencyProbeAt = now;
    const result = await pingTeamSpeakPort(entry.target);
    sendJson({
      type: "latencyPong",
      sequence,
      teamSpeakLatencyMs: result.latencyMs,
      teamSpeakReachable: result.ok,
      teamSpeakErrorCode: result.errorCode ?? null,
    });
    return;
  }

  if (command.type === "switchChannel") {
    const rawId = command.payload.channelId as string;
    const channelPassword = typeof command.payload.password === "string" ? command.payload.password : "";
    try {
      await entry.tsClient.switchChannel(BigInt(rawId), channelPassword || undefined);
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      if (/already member/i.test(rawMessage)) {
        sendJson({ type: "channelSwitched", requestId: command.requestId, channelId: rawId });
        return;
      }
      const operation = classifyOperationError(error, "CHANNEL_SWITCH_FAILED", "频道切换失败");
      sendJson({ type: "error", requestId: command.requestId, error: { code: operation.code, message: operation.message, recoverable: false } });
      return;
    }
    sendJson({ type: "channelSwitched", requestId: command.requestId, channelId: rawId });
    sendJson({ type: "channelList", channels: entry.channelTree });
    return;
  }

  try {
    if (command.type === "sendTextMessage") {
      const message = (command.payload.message as string).trim();
      if (message) await entry.tsClient.sendTextMessage("channel", message, entry.tsClient.getChannelId());
    } else if (command.type === "sendServerMessage") {
      const message = (command.payload.message as string).trim();
      if (message) await entry.tsClient.sendTextMessage("server", message);
    } else if (command.type === "sendPrivateMessage") {
      const clientId = command.payload.clientId as number;
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线", recoverable: false } });
        return;
      }
      const message = (command.payload.message as string).trim();
      if (message) await entry.tsClient.sendTextMessage("private", message, BigInt(clientId));
    } else if (command.type === "poke") {
      const clientId = command.payload.clientId as number;
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线", recoverable: false } });
        return;
      }
      await entry.tsClient.poke(clientId, (command.payload.message as string).trim());
    } else if (command.type === "setAway") {
      await entry.tsClient.setAway(command.payload.away as boolean, typeof command.payload.message === "string" ? command.payload.message.trim() : "");
    } else if (command.type === "setWhisperTargets") {
      const targetIds = command.payload.targetIds as number[];
      const selfId = entry.tsClient.getClientId();
      if (targetIds.some((clientId) => clientId === selfId || !entry.members.has(clientId))) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "私语目标已离线", recoverable: false } });
        return;
      }
      entry.whisperTargetIds = new Set(targetIds);
      if (!entry.whisperTargetIds.size) entry.whisperActive = false;
      sendJson({ type: "whisperTargets", targetIds: [...entry.whisperTargetIds], active: entry.whisperActive });
    } else if (command.type === "setWhisperActive") {
      const active = command.payload.active as boolean;
      if (active && !entry.whisperTargetIds.size) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "NO_WHISPER_TARGETS", message: "请先选择私语目标", recoverable: false } });
        return;
      }
      entry.whisperActive = active;
      sendJson({ type: "whisperTargets", targetIds: [...entry.whisperTargetIds], active: entry.whisperActive });
    } else if (command.type === "setMicrophoneMuted") {
      entry.webrtc?.setMicrophoneMuted(command.payload.muted as boolean);
    } else if (command.type === "setAccompanimentActive") {
      entry.webrtc?.setAccompanimentActive(command.payload.active as boolean);
    } else if (command.type === "setMemberVolume") {
      const clientId = command.payload.clientId as number;
      entry.webrtc?.setMemberVolume(clientId, command.payload.volume as number);
    }
    if (command.requestId) sendJson({ type: "commandCompleted", requestId: command.requestId });
  } catch (error: unknown) {
    const operation = classifyOperationError(error, "OPERATION_FAILED", "操作失败");
    sendJson({ type: "error", requestId: command.requestId, error: { code: operation.code, message: operation.message, recoverable: false } });
  }
}

function classifyOperationError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.toLocaleLowerCase();
  if (/permission|not permitted|insufficient|i_permission|2568/.test(normalized)) return { code: "PERMISSION_DENIED", message: "你没有执行此操作的权限" };
  if (/channel.*(password|password.*required)|invalid.*(channel|password)|i_channel_password|1794/.test(normalized)) return { code: "CHANNEL_PASSWORD_REQUIRED", message: "该频道需要密码" };
  if (/already member/.test(normalized)) return { code: "ALREADY_IN_CHANNEL", message: "你已经在该频道中" };
  if (/full|maximum.*clients/.test(normalized)) return { code: "CHANNEL_FULL", message: "该频道已满" };
  if (/not found|unknown client|invalid client/.test(normalized)) return { code: "CLIENT_NOT_FOUND", message: "成员已离线" };
  return { code: fallbackCode, message: fallbackMessage };
}

function sendProtocolError(sendJson: (message: Record<string, unknown>) => void, code: string, message: string): void {
  sendJson({ type: "error", error: { code, message, recoverable: false } });
}

function parseWebRtcOffer(raw: string): WebRtcSessionDescription | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value) || value.type !== "webrtcOffer" || !isRecord(value.payload) || !isRecord(value.payload.sdp)) return null;
  const description = value.payload.sdp;
  if (description.type !== "offer" || typeof description.sdp !== "string" || description.sdp.length > 256 * 1024) return null;
  if (value.payload.muted !== undefined && typeof value.payload.muted !== "boolean") return null;
  if (value.payload.accompanimentActive !== undefined && typeof value.payload.accompanimentActive !== "boolean") return null;
  return {
    type: "offer",
    sdp: description.sdp,
    muted: value.payload.muted === true,
    accompanimentActive: value.payload.accompanimentActive === true,
  };
}

function isWebRtcStopMessage(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && value.type === "webrtcStop";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChannelRecord(value: unknown): value is { id: string; name: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && typeof (value as { name?: unknown }).name === "string";
}

function createAudioFlowStats(): AudioFlowStats {
  return {
    ingressFrames: 0,
    ingressDroppedFrames: 0,
    ingressFirstAt: null,
    ingressLastAt: null,
    ingressMaxGapMs: 0,
    tsSendFrames: 0,
    tsSendErrors: 0,
    tsSendFirstAt: null,
    tsSendLastAt: null,
    tsSendMaxGapMs: 0,
    tsEncodeMaxMs: 0,
    tsReceiveFrames: 0,
    tsReceiveFirstAt: null,
    tsReceiveLastAt: null,
    tsReceiveMaxGapMs: 0,
    egressFrames: 0,
    egressDroppedFrames: 0,
    egressFirstAt: null,
    egressLastAt: null,
    egressMaxGapMs: 0,
    egressSentFirstAt: null,
    egressSentLastAt: null,
    egressSentMaxGapMs: 0,
    egressPeakBufferedBytes: 0,
    egressFramesByClient: {},
    webrtcIngressRtpFrames: 0,
    webrtcIngressRtpFirstAt: null,
    webrtcIngressRtpLastAt: null,
    webrtcIngressRtpMaxGapMs: 0,
    webrtcEgressRtpFrames: 0,
    webrtcEgressRtpFirstAt: null,
    webrtcEgressRtpLastAt: null,
    webrtcEgressRtpMaxGapMs: 0,
    webrtcQueuePeakFrames: 0,
    webrtcQueueDroppedFrames: 0,
    webrtcQueueUnderrunTicks: 0,
    webrtcPacerLateTicks: 0,
    webrtcQueueCurrentFrames: 0,
    webrtcIngressQuietFrames: 0,
    webrtcIngressDecodeErrors: 0,
    webrtcDownlinkDecodedFrames: 0,
    webrtcDownlinkDecodeErrors: 0,
    webrtcDownlinkShortFrames: 0,
  };
}

function snapshotAudioStats(entry: WebClientEntry): AudioFlowStats {
  const stats = { ...entry.audio };
  const webRtcStats: WebRtcAudioStats | undefined = entry.webrtc?.getStats();
  if (webRtcStats) Object.assign(stats, webRtcStats);
  return stats;
}

function mapChannelTree(snapshot: TSDirectorySnapshot): unknown[] {
  return snapshot.channels.map((channel) => ({
    id: String(channel.id),
    parentID: String(channel.parentID),
    name: channel.name || "未命名频道",
    description: channel.description || "",
    members: snapshot.clients
      .filter((client) => client.channelID === channel.id)
      .map((client) => ({
        id: client.id,
        nickname: client.nickname || "未知用户",
        uid: client.uid,
        away: client.away,
        awayMessage: client.awayMessage,
        inputMuted: client.inputMuted,
        outputMuted: client.outputMuted,
        channelCommander: client.channelCommander,
      })),
  }));
}

function normalizeDirectorySnapshot(
  snapshot: TSDirectorySnapshot,
  selfId: number,
  selfChannelId: bigint,
  nickname: string,
  requestedChannelName?: string,
): TSDirectorySnapshot {
  if (selfId <= 0) return snapshot;

  const clients = snapshot.clients.slice();
  const selfIndex = clients.findIndex((client) => client.id === selfId);
  const snapshotChannelId = selfIndex >= 0 ? clients[selfIndex]!.channelID : 0n;
  const requestedName = requestedChannelName?.trim().toLocaleLowerCase();
  const requestedChannel = requestedName
    ? snapshot.channels.find((channel) => channel.name.trim().toLocaleLowerCase() === requestedName)
    : undefined;
  const resolvedChannelId = selfChannelId !== 0n
    ? selfChannelId
    : snapshotChannelId !== 0n
      ? snapshotChannelId
      : requestedChannel?.id ?? snapshot.channels[0]?.id ?? 0n;
  if (selfIndex >= 0) {
    const current = clients[selfIndex]!;
    if (resolvedChannelId !== 0n) clients[selfIndex] = { ...current, channelID: resolvedChannelId };
  } else if (resolvedChannelId !== 0n) {
    clients.push({ id: selfId, nickname, uid: "", channelID: resolvedChannelId, type: 1, serverGroups: [] });
  }

  return { ...snapshot, clients };
}
