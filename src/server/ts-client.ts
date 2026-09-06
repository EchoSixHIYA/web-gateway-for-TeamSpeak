import { EventEmitter } from "node:events";
import {
  Client as TS3FullClient,
  clientMove as tsClientMove,
  listChannels as tsListChannels,
  listClients as tsListClients,
  poke as tsPoke,
  sendTextMessage as tsSendTextMessage,
  generateIdentity,
  type Identity,
  type VoiceData,
  type DirectoryClientInfo,
  type DirectorySnapshot,
  type TextMessage,
} from "@echosixhiya/teamspeak-client";
import type { Logger } from "../logger.js";
import { TeamSpeakAdapter, type TeamSpeakProtocol } from "./teamspeak-adapter.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";

export interface TSClientOptions {
  target: TeamSpeakTarget;
  nickname: string;
  serverPassword?: string;
  defaultChannel?: string;
  channelPassword?: string;
  identity?: Identity;
}

export interface TSVoiceData {
  clientId: number;
  codec: number; // 4 = voice, 5 = music
  data: Buffer;
}

export type TSDirectorySnapshot = DirectorySnapshot;
export type TSDirectoryClient = DirectoryClientInfo;

export type TSChatScope = "channel" | "server" | "private";

export interface TSChatMessage {
  invokerName: string;
  invokerId: number;
  invokerUid: string;
  message: string;
  targetMode: number;
  targetId: bigint;
}

/**
 * Keep the TeamSpeak target id when adapting SDK events for the gateway.
 * Private-message events include a bigint targetID; dropping it makes the
 * bridge dereference undefined while echoing the message to the browser.
 */
export function toTSChatMessage(msg: TextMessage): TSChatMessage {
  return {
    invokerName: msg.invokerName,
    invokerId: msg.invokerID,
    invokerUid: msg.invokerUID,
    message: msg.message,
    targetMode: msg.targetMode,
    targetId: msg.targetID,
  };
}

export class TSClient extends EventEmitter {
  private client: TS3FullClient | null = null;
  private adapter: TeamSpeakAdapter | null = null;
  private logger: Logger;
  private readonly identity: Identity;
  private clientId = 0;
  private connected = false;
  private preferredChannelId = 0n;

  constructor(private options: TSClientOptions, logger: Logger) {
    super();
    this.logger = logger.child({ nickname: options.nickname });
    this.identity = options.identity ?? generateIdentity(8);
  }

  async connect(): Promise<void> {
    if (!this.adapter || !this.client) {
      this.adapter = new TeamSpeakAdapter({
        target: this.options.target,
        nickname: this.options.nickname,
        identity: this.identity,
        serverPassword: this.options.serverPassword,
        defaultChannel: this.options.defaultChannel,
        channelPassword: this.options.channelPassword,
      }, this.logger);
      this.client = this.adapter.client;
      this.attachClientListeners(this.client);
    }
    const adapter = this.adapter;
    const client = this.client;

    await adapter.connect();

    this.clientId = client.clientID();
    try {
      // A native TeamSpeak client subscribes to the complete channel tree
      // after the welcome sequence. Without this command the server only
      // exposes members in the current channel, so users disappear as soon as
      // they move elsewhere even though both clients are on the same server.
      await client.execCommand("channelsubscribeall", 5000);
    } catch (error: unknown) {
      this.logger.warn({
        err: error instanceof Error ? error.message : String(error),
      }, "Could not subscribe to all TeamSpeak channels");
    }
    // Directory snapshots are dispatched through two setImmediate layers in
    // the SDK. Let both flush before reconciling with a direct client-protocol
    // snapshot so the gateway's first connected state contains every member.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // TS6 can finish the welcome event stream before it has exposed every
    // existing client to a newly connected session. Pull one authoritative
    // snapshot through this same client protocol session so users who joined
    // earlier are visible immediately as well. Realtime events continue to
    // keep the snapshot current after this reconciliation.
    try {
      const [channels, clients] = await Promise.all([
        tsListChannels(client),
        tsListClients(client),
      ]);
      this.emit("directorySnapshot", { channels, clients });
    } catch (error: unknown) {
      this.logger.warn({
        err: error instanceof Error ? error.message : String(error),
      }, "Could not reconcile the TeamSpeak directory snapshot");
    }

    const connectedChannelId = client.channelID();
    if (this.preferredChannelId === 0n) {
      this.preferredChannelId = connectedChannelId;
    } else if (connectedChannelId !== this.preferredChannelId) {
      try {
        await tsClientMove(client, this.clientId, this.preferredChannelId);
      } catch (error: unknown) {
        // The old channel may have been deleted or become inaccessible. The
        // SDK has already left us in the server/default channel, which is the
        // safe fallback required by the reconnect contract.
        this.logger.info({
          channelId: this.preferredChannelId.toString(),
          err: error instanceof Error ? error.message : String(error),
        }, "Previous TeamSpeak channel could not be restored");
        this.preferredChannelId = client.channelID();
      }
    }
    this.connected = true;

    this.logger.info({ clientId: this.clientId }, "Connected to TeamSpeak");
    this.emit("connected", this.clientId);
  }

  private attachClientListeners(client: TS3FullClient): void {
    client.on("voiceData", (data: VoiceData) => {
      this.emit("voiceData", {
        clientId: data.clientId,
        codec: data.codec,
        data: Buffer.from(data.data),
      } as TSVoiceData);
    });

    // The SDK exposes the directory that TeamSpeak sends during the normal
    // client welcome sequence. The connect path also reconciles this event
    // stream with a complete client-protocol snapshot.
    client.on("directorySnapshot", (snapshot) => {
      this.emit("directorySnapshot", {
        channels: snapshot.channels.slice(),
        clients: snapshot.clients.slice(),
      });
    });

    client.on("textMessage", (msg) => {
      this.emit("textMessage", toTSChatMessage(msg));
    });

    client.on("poked", (event) => {
      this.emit("poked", event);
    });

    client.on("disconnected", (err) => {
      this.logger.warn({ err: err?.message }, "Disconnected from TS");
      this.connected = false;
      this.clientId = 0;
      this.emit("disconnected", err);
    });

    client.on("clientEnter", (info) => {
      this.emit("clientEnter", info);
    });

    client.on("clientLeave", (info) => {
      this.emit("clientLeave", info);
    });

    client.on("clientMoved", (info) => {
      if (info.id === this.clientId && info.targetChannelID !== 0n) this.preferredChannelId = info.targetChannelID;
      this.emit("clientMoved", info);
    });
  }

  sendVoice(data: Buffer, codec: number = 4): void {
    if (!this.client || !this.connected) return;
    this.client.sendVoice(data, codec);
  }

  sendWhisper(data: Buffer, clientIds: number[], codec: number = 4): void {
    if (!this.client || !this.connected) return;
    const targets = [...new Set(clientIds)].filter((clientId) => Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== this.getClientId());
    if (!targets.length) throw new Error("Whisper requires at least one valid target");
    this.client.sendWhisper(data, targets, codec);
  }

  async sendTextMessage(scope: TSChatScope, message: string, targetId = 0n): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    const targetMode = scope === "private" ? 1 : scope === "server" ? 3 : 2;
    await tsSendTextMessage(this.client, targetMode, targetId, message);
  }

  async poke(clientId: number, message: string): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    await tsPoke(this.client, clientId, message);
  }

  async setAway(away: boolean, message = ""): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    const escaped = escapeTeamSpeakValue(message);
    await this.client.execCommand(`clientupdate client_away=${away ? 1 : 0} client_away_message=${escaped}`);
  }

  async switchChannel(channelId: bigint, password?: string): Promise<void> {
    if (!this.client || !this.connected) return;
    await tsClientMove(this.client, this.clientId, channelId, password);
    this.preferredChannelId = channelId;
  }

  getClientId(): number {
    // The SDK learns the real client id during the welcome sequence, before
    // TSClient.connect() resumes. Reading it from the SDK prevents the first
    // directory snapshot from being built without the web client itself.
    return this.client?.clientID() ?? this.clientId;
  }

  getProtocol(): TeamSpeakProtocol | null {
    return this.adapter?.protocol ?? null;
  }

  async execCommandWithResponse(command: string, timeoutMs = 3000): Promise<Record<string, string>[]> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    return this.client.execCommandWithResponse(command, timeoutMs);
  }

  getIdentityString(): string {
    return this.identity.toString();
  }

  getChannelId(): bigint {
    if (!this.client) return 0n;
    const sdkClient = this.client as unknown as { channelID?: () => bigint };
    return sdkClient.channelID?.() ?? 0n;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.adapter) await this.adapter.disconnect();
    this.adapter = null;
    this.client = null;
    this.clientId = 0;
  }
}

function escapeTeamSpeakValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\s")
    .replace(/\//g, "\\/")
    .replace(/\|/g, "\\p")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
