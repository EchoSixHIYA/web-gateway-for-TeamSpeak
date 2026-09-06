import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import {
  MediaStreamTrack,
  RtpHeader,
  RtpPacket,
  RTCPeerConnection,
} from "werift";
import type { Logger as LoggerType } from "../logger.js";
import type { TSVoiceData } from "./ts-client.js";
import { WEBRTC_UDP_PORT_RANGE } from "./webrtc-config.js";

export { DEFAULT_WEBRTC_UDP_PORT_RANGE, WEBRTC_UDP_PORT_RANGE } from "./webrtc-config.js";

const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus") as {
  OpusEncoder: new (sampleRate: number, channels: number) => {
    decode(data: Buffer): Buffer;
    encode(data: Buffer): Buffer;
  };
};

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_FRAME_SAMPLES = 960;
const AUDIO_FRAME_BYTES = AUDIO_FRAME_SAMPLES * 2;
const DEFAULT_WEBRTC_OPUS_PAYLOAD_TYPE = 111;
const AUDIO_CLOCK_INTERVAL_MS = 20;
const SPEAKER_ACTIVITY_INTERVAL_MS = 100;
const MAX_MIXER_QUEUE_FRAMES = 4;
const MAX_MIXER_PACER_LAG_MS = AUDIO_CLOCK_INTERVAL_MS * 2;
const MAX_MIXER_FRAME_AGE_MS = MAX_MIXER_QUEUE_FRAMES * AUDIO_CLOCK_INTERVAL_MS;
const MIXER_UNDERRUN_WINDOW_MS = 200;
// This threshold is used only for the speaking indicator. It must never decide
// whether a media packet is forwarded or queued: quiet/comfort-noise Opus
// packets are still valid media and dropping them can break decoder continuity.
const SPEAKER_ACTIVITY_RMS = 160;

// WebRTC is served by the WebSpeak process itself. The default range is also
// published by the bundled Docker Compose file; advanced administrators can
// change it in the admin console before enabling WebRTC.
export interface WebRtcAudioOptions {
  enabled: boolean;
  udpPortRange?: [number, number];
}

export interface WebRtcSessionDescription {
  type: "offer" | "answer";
  sdp: string;
  muted?: boolean;
  accompanimentActive?: boolean;
}

export interface WebRtcAudioSessionOptions {
  connectionId: string;
  publicHost?: string;
  udpPortRange?: [number, number];
  logger: LoggerType;
  microphoneMuted?: boolean;
  accompanimentActive?: boolean;
  onVoiceFrame: (data: Buffer, codec: 4 | 5) => void;
  onVoiceActivity: (clientIds: number[]) => void;
}

export interface WebRtcAudioStats {
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

interface PendingAudioFrame {
  pcm: Buffer;
  receivedAt: number;
  /** Preserve a native 20 ms Opus frame when no mix is required. */
  opus?: Buffer;
}

interface SelectedAudioFrame extends PendingAudioFrame {
  clientId: number;
  volume: number;
}

/**
 * One low-latency WebRTC audio session for one browser connection.
 *
 * TeamSpeak provides one Opus payload per speaker. WebRTC has one negotiated
 * audio track in this first transport, so this class mixes one 20 ms frame
 * from each active speaker and packetizes the result as RTP. Each speaker has
 * a very small bounded queue so bursts from the TeamSpeak adapter can be
 * smoothed without turning into an ever-growing playback delay.
 */
export class WebRtcAudioSession {
  readonly peer: RTCPeerConnection;
  private readonly logger: LoggerType;
  private readonly onVoiceFrame: (data: Buffer, codec: 4 | 5) => void;
  private readonly onVoiceActivity: (clientIds: number[]) => void;
  private readonly outgoingTrack: MediaStreamTrack;
  private readonly decoderByClient = new Map<number, { decode(data: Buffer): Buffer }>();
  private readonly partialPcmByClient = new Map<number, Buffer>();
  private readonly pendingFrames = new Map<number, PendingAudioFrame[]>();
  private readonly memberVolumes = new Map<number, number>();
  private readonly activeSpeakerIds = new Set<number>();
  private readonly opusPayloadTypes = new Set<number>();
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly activityTimer: ReturnType<typeof setInterval>;
  private encoder: { encode(data: Buffer): Buffer } | null;
  private sequenceNumber = randomInt(0, 65_536);
  private timestamp = randomInt(0, 0x1_0000_0000) >>> 0;
  private readonly ssrc = randomInt(1, 0x1_0000_0000) >>> 0;
  private outgoingPayloadType = DEFAULT_WEBRTC_OPUS_PAYLOAD_TYPE;
  private closed = false;
  private nextAudioDeadline = 0;
  private lastIngressRtpAt: number | null = null;
  private lastEgressRtpAt: number | null = null;
  private lastQueueEnqueuedAt: number | null = null;
  private accompanimentActive: boolean;
  private readonly stats: WebRtcAudioStats = {
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

  constructor(options: WebRtcAudioSessionOptions) {
    this.logger = options.logger.child({ component: "webrtc-audio", connectionId: options.connectionId });
    this.onVoiceFrame = options.onVoiceFrame;
    this.onVoiceActivity = options.onVoiceActivity;
    this.accompanimentActive = options.accompanimentActive === true;
    this.outgoingTrack = new MediaStreamTrack({ kind: "audio" });

    const iceAdditionalHostAddresses = options.publicHost ? [options.publicHost] : undefined;
    const udpPortRange = options.udpPortRange ?? WEBRTC_UDP_PORT_RANGE;
    this.peer = new RTCPeerConnection({
      iceServers: [],
      iceUseIpv4: true,
      iceUseIpv6: false,
      iceUseTcp: false,
      icePortRange: [...udpPortRange] as [number, number],
      ...(iceAdditionalHostAddresses ? { iceAdditionalHostAddresses } : {}),
    });

    const audio = this.peer.addTransceiver("audio", { direction: "sendrecv" });
    audio.onTrack.subscribe((track) => {
      track.onReceiveRtp.subscribe((rtp) => {
        if (this.closed) return;
        const receivedAt = performance.now();
        if (this.lastIngressRtpAt !== null) this.stats.webrtcIngressRtpMaxGapMs = Math.max(this.stats.webrtcIngressRtpMaxGapMs, Math.round(receivedAt - this.lastIngressRtpAt));
        this.lastIngressRtpAt = receivedAt;
        this.stats.webrtcIngressRtpFirstAt ??= Date.now();
        this.stats.webrtcIngressRtpLastAt = Date.now();
        this.stats.webrtcIngressRtpFrames++;
        if (!this.opusPayloadTypes.has(rtp.header.payloadType)) return;
        const payload = Buffer.from(rtp.payload);
        // Forward every valid negotiated Opus payload unchanged. Do not
        // decode it for RMS analysis or pass it through a speech/silence gate:
        // quiet frames are still part of the codec timeline and dropping them
        // can cause downstream gaps, clicks, or decoder recovery artifacts.
        this.onVoiceFrame(payload, this.accompanimentActive ? 5 : 4);
      });
      void audio.sender.replaceTrack(this.outgoingTrack).catch((error: unknown) => {
        this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not attach WebRTC output track");
      });
    });
    void audio.sender.replaceTrack(this.outgoingTrack).catch((error: unknown) => {
      this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not prepare WebRTC output track");
    });

    try {
      this.encoder = new OpusEncoder(AUDIO_SAMPLE_RATE, 1);
    } catch (error: unknown) {
      this.encoder = null;
      this.logger.error({ err: error instanceof Error ? error.message : String(error) }, "Could not create WebRTC mixer encoder");
    }
    if (!this.encoder) {
      this.outgoingTrack.stop();
      throw new Error("WebRTC Opus codec is unavailable");
    }

    this.nextAudioDeadline = performance.now();
    this.scheduleAudioTick();
    this.activityTimer = setInterval(() => this.flushSpeakerActivity(), SPEAKER_ACTIVITY_INTERVAL_MS);
    this.activityTimer.unref?.();
    this.peer.onconnectionstatechange = () => {
      this.logger.info({ state: this.peer.connectionState }, "WebRTC connection state changed");
    };
  }

  getStats(): WebRtcAudioStats {
    return { ...this.stats, webrtcQueueCurrentFrames: this.getQueueFrameCount() };
  }

  async createAnswer(offer: WebRtcSessionDescription): Promise<WebRtcSessionDescription> {
    if (this.closed) throw new Error("WebRTC session is closed");
    this.setOpusPayloadTypes(offer.sdp);
    await this.peer.setRemoteDescription(offer);
    const transceiver = this.peer.getTransceivers().find((candidate) => candidate.kind === "audio");
    if (transceiver) await transceiver.sender.replaceTrack(this.outgoingTrack);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    const description = this.peer.localDescription;
    if (!description) throw new Error("WebRTC answer was not created");
    if (description.type !== "answer" && description.type !== "offer") throw new Error("Unexpected WebRTC answer type");
    return { type: description.type, sdp: description.sdp };
  }

  pushTeamSpeakVoice(data: TSVoiceData): void {
    if (this.closed || (data.codec !== 4 && data.codec !== 5)) return;
    let decoder = this.decoderByClient.get(data.clientId);
    if (!decoder) {
      try {
        // @discordjs/opus exposes decoding on OpusEncoder instances too;
        // there is no separate OpusDecoder constructor in that package.
        decoder = new OpusEncoder(AUDIO_SAMPLE_RATE, 1);
        this.decoderByClient.set(data.clientId, decoder);
      } catch (error: unknown) {
        this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not create WebRTC mixer decoder");
        return;
      }
    }
    try {
      const pcm = decoder.decode(data.data);
      this.stats.webrtcDownlinkDecodedFrames++;
      if (pcm.length < 2) {
        this.stats.webrtcDownlinkShortFrames++;
        return;
      }
      // TeamSpeak may deliver 10/20/40/60 ms Opus frames. Keep a partial
      // decoded frame per speaker and split every decoded buffer into the
      // fixed 20 ms cadence used by the WebRTC mixer instead of discarding
      // anything after the first 20 ms.
      const pendingPcm = this.partialPcmByClient.get(data.clientId);
      const combined = pendingPcm ? Buffer.concat([pendingPcm, pcm]) : pcm;
      const rms = this.calculateRms(pcm);
      // RMS is used only for the UI speaking indicator. Every decoded frame,
      // including quiet/comfort-noise frames, continues into the queue so the
      // receiver keeps an uninterrupted codec timeline.
      if (rms >= SPEAKER_ACTIVITY_RMS) this.activeSpeakerIds.add(data.clientId);
      const canForwardOpus = !pendingPcm && pcm.length === AUDIO_FRAME_BYTES;
      let offset = 0;
      let enqueued = false;
      let queue = this.pendingFrames.get(data.clientId);
      while (offset + AUDIO_FRAME_BYTES <= combined.length) {
        if (!queue) {
          queue = [];
          this.pendingFrames.set(data.clientId, queue);
        }
        if (queue.length >= MAX_MIXER_QUEUE_FRAMES) {
          queue.shift();
          this.stats.webrtcQueueDroppedFrames++;
        }
        queue.push({
          pcm: Buffer.from(combined.subarray(offset, offset + AUDIO_FRAME_BYTES)),
          receivedAt: performance.now(),
          ...(canForwardOpus && offset === 0 ? { opus: Buffer.from(data.data) } : {}),
        });
        enqueued = true;
        offset += AUDIO_FRAME_BYTES;
      }
      if (offset < combined.length) this.partialPcmByClient.set(data.clientId, Buffer.from(combined.subarray(offset)));
      else this.partialPcmByClient.delete(data.clientId);
      if (enqueued) {
        this.lastQueueEnqueuedAt = performance.now();
        this.stats.webrtcQueuePeakFrames = Math.max(this.stats.webrtcQueuePeakFrames, this.getQueueFrameCount());
      }
    } catch {
      this.stats.webrtcDownlinkDecodeErrors++;
      // A malformed or codec-transition packet is discarded without touching
      // the peer connection. The next valid Opus frame can recover the stream.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    clearInterval(this.activityTimer);
    this.pendingFrames.clear();
    this.memberVolumes.clear();
    this.partialPcmByClient.clear();
    this.activeSpeakerIds.clear();
    this.decoderByClient.clear();
    this.encoder = null;
    this.outgoingTrack.stop();
    await this.peer.close();
  }

  private scheduleAudioTick(): void {
    if (this.closed) return;
    const delay = Math.max(0, this.nextAudioDeadline - performance.now());
    this.audioTimer = setTimeout(() => this.flushAudio(), delay);
    this.audioTimer.unref?.();
  }

  private flushAudio(): void {
    if (this.closed) return;
    const now = performance.now();
    if (now > this.nextAudioDeadline + MAX_MIXER_PACER_LAG_MS) {
      this.stats.webrtcPacerLateTicks++;
      this.nextAudioDeadline = now;
      this.trimQueuesAfterLateTick();
    }
    this.nextAudioDeadline += AUDIO_CLOCK_INTERVAL_MS;
    this.audioTimer = null;
    this.mixAndSendAudio();
    this.scheduleAudioTick();
  }

  private mixAndSendAudio(): void {
    if (!this.encoder) {
      return;
    }
    if (!this.pendingFrames.size) {
      if (this.lastQueueEnqueuedAt !== null && performance.now() - this.lastQueueEnqueuedAt <= MIXER_UNDERRUN_WINDOW_MS) {
        this.stats.webrtcQueueUnderrunTicks++;
      }
    }
    const mixed = new Int32Array(AUDIO_FRAME_SAMPLES);
    const selectedFrames: SelectedAudioFrame[] = [];
    for (const [clientId, queue] of this.pendingFrames) {
      const frame = queue.shift();
      if (queue.length === 0) this.pendingFrames.delete(clientId);
      if (!frame) continue;
      const volume = this.memberVolumes.get(clientId) ?? 1;
      selectedFrames.push({ ...frame, clientId, volume });
      for (let index = 0; index < AUDIO_FRAME_SAMPLES; index++) {
        mixed[index] += Math.round(frame.pcm.readInt16LE(index * 2) * volume);
      }
    }

    if (selectedFrames.length === 1 && selectedFrames[0]?.opus && selectedFrames[0].volume === 1) {
      this.sendRtpAudio(selectedFrames[0].opus);
      return;
    }

    const pcm = Buffer.allocUnsafe(AUDIO_FRAME_BYTES);
    for (let index = 0; index < AUDIO_FRAME_SAMPLES; index++) {
      // Keep a fixed gain for the mixed path. Per-sample soft limiting changes
      // the waveform's apparent loudness as the source level changes, which
      // is especially noticeable on music. Only clip actual overflow caused
      // by simultaneous speakers; never normalize by the active speaker count.
      const sample = Math.max(-32_768, Math.min(32_767, mixed[index]!));
      pcm.writeInt16LE(sample, index * 2);
    }
    try {
      const encoded = this.encoder.encode(pcm);
      this.sendRtpAudio(encoded);
    } catch {
      // A peer closing concurrently may reject a packet; teardown owns the
      // session lifecycle and no per-frame error needs to reach the logs.
    }
  }

  private sendRtpAudio(encoded: Buffer): void {
    const packet = new RtpPacket(new RtpHeader({
      payloadType: this.outgoingPayloadType,
      sequenceNumber: this.sequenceNumber,
      timestamp: this.timestamp,
      ssrc: this.ssrc,
      marker: true,
    }), encoded);
    this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;
    this.timestamp = (this.timestamp + AUDIO_FRAME_SAMPLES) >>> 0;
    this.outgoingTrack.writeRtp(packet);
    const sentAt = performance.now();
    if (this.lastEgressRtpAt !== null) this.stats.webrtcEgressRtpMaxGapMs = Math.max(this.stats.webrtcEgressRtpMaxGapMs, Math.round(sentAt - this.lastEgressRtpAt));
    this.lastEgressRtpAt = sentAt;
    this.stats.webrtcEgressRtpFirstAt ??= Date.now();
    this.stats.webrtcEgressRtpLastAt = Date.now();
    this.stats.webrtcEgressRtpFrames++;
  }

  private flushSpeakerActivity(): void {
    if (this.closed || !this.activeSpeakerIds.size) return;
    const ids = [...this.activeSpeakerIds];
    this.activeSpeakerIds.clear();
    this.onVoiceActivity(ids);
  }

  setMicrophoneMuted(muted: boolean): void {
    // The browser sends a mixed microphone/accompaniment track. The mute gain
    // is applied before RTP encoding, so a server-side mute flag must not drop
    // the whole packet and silence a still-playing accompaniment.
    void muted;
  }

  setAccompanimentActive(active: boolean): void {
    this.accompanimentActive = active;
  }

  setMemberVolume(clientId: number, volume: number): void {
    if (!Number.isInteger(clientId) || clientId <= 0 || clientId > 65535 || !Number.isFinite(volume)) return;
    const normalized = Math.max(0, Math.min(4, volume));
    if (normalized === 1) this.memberVolumes.delete(clientId);
    else this.memberVolumes.set(clientId, normalized);
  }

  private calculateRms(pcm: Buffer): number {
    let sum = 0;
    let samples = 0;
    for (let index = 0; index + 1 < pcm.length; index += 2) {
      const sample = pcm.readInt16LE(index);
      sum += sample * sample;
      samples++;
    }
    return samples ? Math.sqrt(sum / samples) : 0;
  }

  private trimQueuesAfterLateTick(): void {
    const now = performance.now();
    for (const [clientId, queue] of this.pendingFrames) {
      while (queue.length > 1) {
        queue.shift();
        this.stats.webrtcQueueDroppedFrames++;
      }
      if (queue[0] && now - queue[0].receivedAt > MAX_MIXER_FRAME_AGE_MS) {
        queue.shift();
        this.stats.webrtcQueueDroppedFrames++;
      }
      if (queue.length === 0) this.pendingFrames.delete(clientId);
    }
  }

  private getQueueFrameCount(): number {
    let count = 0;
    for (const queue of this.pendingFrames.values()) count += queue.length;
    return count;
  }

  private setOpusPayloadTypes(sdp: string): void {
    this.opusPayloadTypes.clear();
    for (const match of sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?/gim)) {
      const payloadType = Number(match[1]);
      if (!Number.isInteger(payloadType) || payloadType < 0 || payloadType > 127) continue;
      this.opusPayloadTypes.add(payloadType);
      this.outgoingPayloadType = payloadType;
    }
    if (!this.opusPayloadTypes.size) this.opusPayloadTypes.add(DEFAULT_WEBRTC_OPUS_PAYLOAD_TYPE);
  }
}
