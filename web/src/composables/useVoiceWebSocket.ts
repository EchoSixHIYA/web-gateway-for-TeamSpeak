import { reactive, ref } from "vue";
import { loadLocalPreferences, saveLocalPreferences } from "../services/local-persistence.js";

const micCaptureWorkletUrl = "/mic-capture-worklet.js";

export interface VoiceState {
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  reconnectFailed: boolean;
  tsClientId: number;
  error: string;
  errorCode: string;
  channelSwitchedChannelId: string;
}

export interface ChannelMember {
  id: number;
  nickname: string;
  uid?: string;
  isSelf?: boolean;
  away?: boolean;
  awayMessage?: string;
  inputMuted?: boolean;
  outputMuted?: boolean;
  channelCommander?: boolean;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export type AudioPermission = "unknown" | "granted" | "denied";

type SinkAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export interface ChannelInfo {
  id: string;
  parentID: string;
  name: string;
  description?: string;
  members?: { id: number; nickname: string; uid?: string; away?: boolean; awayMessage?: string; inputMuted?: boolean; outputMuted?: boolean; channelCommander?: boolean }[];
}

export interface ChatMessage {
  id: string;
  scope: "channel" | "server" | "private" | "system";
  targetId?: string;
  conversationId?: string;
  senderId?: number;
  senderUid?: string;
  invokerName: string;
  message: string;
  timestamp: number;
  isSelf?: boolean;
}

export interface ServerEvent {
  id: string;
  kind: string;
  message: string;
  timestamp: number;
}

export function useVoiceWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const state = reactive<VoiceState>({ connected: false, connecting: false, reconnecting: false, reconnectAttempt: 0, reconnectFailed: false, tsClientId: 0, error: "", errorCode: "", channelSwitchedChannelId: "" });
  const members = reactive<ChannelMember[]>([]);
  const channels = reactive<ChannelInfo[]>([]);
  const chatMessages = reactive<ChatMessage[]>([]);
  const serverEvents = reactive<ServerEvent[]>([]);
  const pokeNotifications = reactive<{ id: string; invokerId: number; invokerUid: string; invokerName: string; message: string; timestamp: number }[]>([]);
  let connectionSequence = 0;
  let lastConnection: { target: string; channel: string; nickname: string; serverPassword: string; identity?: string; rememberIdentity: boolean } | null = null;
  let webrtcPeer: RTCPeerConnection | null = null;
  let webrtcOutputElement: SinkAudioElement | null = null;
  let webrtcPlaybackStream: MediaStream | null = null;
  let webrtcPlaybackRetryCleanup: (() => void) | null = null;
  let webrtcNegotiationPromise: Promise<void> | null = null;
  let webrtcFallbackStarted = false;
  const webrtcActive = ref(false);
  const identityMaterial = ref("");
  const storedVolumesByUid = reactive<Record<string, number>>({});
  let microphoneStartPromise: Promise<void> | null = null;

  // WebRTC carries audio when the gateway advertises it. The bounded PCM
  // WebSocket path remains the compatibility fallback for older browsers and
  // for deployments where the gateway's built-in UDP media range is unavailable.
  let audioCtx: SinkAudioContext | null = null;
  let micStream: MediaStream | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let workletContext: AudioContext | null = null;
  let workletModulePromise: Promise<void> | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let micGain: GainNode | null = null;
  let silentGain: GainNode | null = null;
  const accompanimentActive = ref(false);
  const accompanimentSupported = ref(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia));
  const accompanimentErrorCode = ref<"" | "unsupported" | "needsWebRtc" | "noAudio" | "permission">("");
  let accompanimentStream: MediaStream | null = null;
  let webrtcMixDestination: MediaStreamAudioDestinationNode | null = null;
  let webrtcMixMicSource: MediaStreamAudioSourceNode | null = null;
  let webrtcMixMicGain: GainNode | null = null;
  let webrtcMixAccompanimentSource: MediaStreamAudioSourceNode | null = null;
  let webrtcMicMonitorSource: MediaStreamAudioSourceNode | null = null;
  let webrtcMicMonitorAnalyser: AnalyserNode | null = null;
  let webrtcMicMonitorGain: GainNode | null = null;
  let webrtcMicMonitorTimer: ReturnType<typeof setInterval> | null = null;
  const inputDevices = reactive<AudioInputDevice[]>([]);
  const outputDevices = reactive<AudioOutputDevice[]>([]);
  const selectedInputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:input-device") ?? "" : "");
  const selectedOutputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:output-device") ?? "" : "");
  const outputDeviceSupported = ref(false);
  const audioPermission = ref<AudioPermission>("unknown");
  const audioContextState = ref<AudioContextState | "unknown">("unknown");
  const micLevel = ref(0);
  const microphoneTestActive = ref(false);
  const testAudioUrl = ref("");
  let testRecorder: MediaRecorder | null = null;
  let testRecorderTimer: ReturnType<typeof setTimeout> | null = null;
  const microphoneMuted = ref(false);
  const inputVolume = ref(1);
  const outputVolume = ref(1);
  const outputMuted = ref(false);
  const notificationVolume = ref(0.5);
  const voxThreshold = ref(0.008);
  let voxAttack = 0;
  let voxRelease = 0;
  const VOX_HOLD = 15;
  const VOX_ATTACK_FRAMES = 1;
  let convBuf = new Int16Array(1024);
  let accumBuf = new Int16Array(2048);
  let accumLen = 0;

  // Playback is kept per client so frames from multiple speakers cannot
  // interleave into one decoder or one scheduling queue.
  const remoteDecoders = new Map<number, AudioDecoder>();
  const remoteDecoderGenerations = new Map<number, number>();
  let nextRemoteDecoderGeneration = 0;
  const remotePlayTimes = new Map<number, number>();
  const remotePlaybackSources = new Map<number, Set<AudioBufferSourceNode>>();
  const remoteGains = new Map<number, GainNode>();
  const remoteDecodeTimestamps = new Map<number, number>();
  const volumes = reactive<Record<number, number>>({});
  const speakingIds = reactive(new Set<number>());
  const whisperTargetIds = reactive(new Set<number>());
  const whisperActive = ref(false);
  const speakingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const SPEAKING_HOLD_MS = 360;
  const AUDIO_FRAME_SAMPLES = 960;
  const AUDIO_FRAME_BYTES = AUDIO_FRAME_SAMPLES * 2;
  const MAX_AUDIO_BUFFERED_FRAMES = 10;
  const MAX_AUDIO_BUFFERED_BYTES = AUDIO_FRAME_BYTES * MAX_AUDIO_BUFFERED_FRAMES;
  // Keep the WebSocket playback buffer below the 100 ms latency target. A
  // 20 ms frame plus three queued decoder frames leaves only a short cushion
  // for jitter; stale audio is discarded instead of being played late.
  const MAX_REMOTE_PLAY_AHEAD_SECONDS = 0.08;
  const MAX_REMOTE_DECODE_QUEUE_FRAMES = 3;

  async function saveAudioPreferences(): Promise<void> {
    await saveLocalPreferences({
      schemaVersion: 1,
      preferredInputDeviceId: selectedInputDeviceId.value,
      inputDeviceId: selectedInputDeviceId.value,
      microphoneMuted: microphoneMuted.value,
      voxThreshold: voxThreshold.value,
      inputGain: inputVolume.value,
      outputVolume: outputVolume.value,
      notificationVolume: notificationVolume.value,
      preferredOutputDeviceId: selectedOutputDeviceId.value,
      volumesByUid: { ...storedVolumesByUid },
    });
  }

  function syncKnownMemberVolumes(): void {
    for (const member of members) {
      if (!member.uid) continue;
      const saved = storedVolumesByUid[member.uid];
      if (saved !== undefined) volumes[member.id] = Math.max(0, Math.min(4, saved));
    }
  }

  void loadLocalPreferences().then((preferences) => {
    if (!selectedInputDeviceId.value) selectedInputDeviceId.value = preferences.preferredInputDeviceId ?? preferences.inputDeviceId ?? "";
    if (typeof preferences.microphoneMuted === "boolean") microphoneMuted.value = preferences.microphoneMuted;
    if (typeof preferences.voxThreshold === "number") voxThreshold.value = clamp(preferences.voxThreshold, 0.001, 0.08);
    if (typeof preferences.inputGain === "number") inputVolume.value = Math.max(0, Math.min(1, preferences.inputGain));
    if (typeof preferences.outputVolume === "number") outputVolume.value = Math.max(0, Math.min(1, preferences.outputVolume));
    if (!selectedOutputDeviceId.value) selectedOutputDeviceId.value = preferences.preferredOutputDeviceId ?? "";
    if (typeof preferences.notificationVolume === "number") notificationVolume.value = clamp(preferences.notificationVolume, 0, 1);
    Object.assign(storedVolumesByUid, preferences.volumesByUid ?? {});
    syncKnownMemberVolumes();
  });

  function markSpeaking(clientId: number): void {
    if (!clientId) return;
    speakingIds.add(clientId);
    const previous = speakingTimers.get(clientId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      speakingIds.delete(clientId);
      speakingTimers.delete(clientId);
    }, SPEAKING_HOLD_MS);
    speakingTimers.set(clientId, timer);
  }

  function clearSpeaking(clientId: number): void {
    const timer = speakingTimers.get(clientId);
    if (timer) clearTimeout(timer);
    speakingTimers.delete(clientId);
    speakingIds.delete(clientId);
  }

  function clearSpeakingState(): void {
    for (const timer of speakingTimers.values()) clearTimeout(timer);
    speakingTimers.clear();
    speakingIds.clear();
  }

  function effectiveOutputVolume(): number {
    return outputMuted.value ? 0 : outputVolume.value;
  }

  function applyOutputVolume(): void {
    const level = effectiveOutputVolume();
    for (const [clientId, gain] of remoteGains) gain.gain.value = (volumes[clientId] ?? 1) * level;
    if (webrtcOutputElement) webrtcOutputElement.volume = level;
  }

  function getAudioCtx(): SinkAudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate: 48000 }) as SinkAudioContext;
      audioContextState.value = audioCtx.state;
      audioCtx.addEventListener("statechange", () => {
        if (audioCtx) audioContextState.value = audioCtx.state;
      });
      outputDeviceSupported.value = typeof audioCtx.setSinkId === "function"
        || typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
      if (selectedOutputDeviceId.value && outputDeviceSupported.value) {
        void setAudioSink(audioCtx, selectedOutputDeviceId.value).catch(() => undefined);
      }
    }
    return audioCtx;
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  async function setAudioSink(ctx: SinkAudioContext, deviceId: string): Promise<void> {
    const mediaSinkSupported = typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
    if (!ctx.setSinkId && !mediaSinkSupported) {
      outputDeviceSupported.value = false;
      if (deviceId) throw new Error("当前浏览器不支持扬声器设备选择，将使用默认输出设备");
      return;
    }
    outputDeviceSupported.value = true;
    if (ctx.setSinkId) await ctx.setSinkId(deviceId || "default");
    if (webrtcOutputElement?.setSinkId) await webrtcOutputElement.setSinkId(deviceId || "default");
  }

  function installWebRtcPlaybackRetry(): void {
    if (webrtcPlaybackRetryCleanup) return;
    const retry = () => { void syncWebRtcPlayback(); };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown"];
    for (const event of events) window.addEventListener(event, retry, { passive: true });
    document.addEventListener("visibilitychange", retry, { passive: true });
    webrtcPlaybackRetryCleanup = () => {
      for (const event of events) window.removeEventListener(event, retry);
      document.removeEventListener("visibilitychange", retry);
      webrtcPlaybackRetryCleanup = null;
    };
  }

  async function syncWebRtcPlayback(): Promise<void> {
    const output = webrtcOutputElement;
    if (!output || !webrtcPlaybackStream) return;
    // Keep WebRTC on the browser's native MediaStream playback path. The
    // capture AudioContext is intentionally not used as a second output
    // route: a running-but-silent graph could leave the UI reporting a live
    // speaker while the actual remote audio element remained muted.
    output.muted = false;
    try {
      await output.play();
      webrtcPlaybackRetryCleanup?.();
    } catch {
      // Mobile and privacy-focused browsers can require a gesture even for a
      // MediaStream. Keep retrying after the next real interaction.
      installWebRtcPlaybackRetry();
    }
  }

  function checkSupport(): string | null {
    if (typeof window === "undefined") return null;
    if (!window.isSecureContext) return "语音功能需要 HTTPS 安全连接";
    if (!navigator.mediaDevices?.getUserMedia) return "当前浏览器不支持麦克风访问";
    if (typeof AudioContext === "undefined") return "当前浏览器不支持 Web Audio 音频处理";
    if (typeof AudioDecoder === "undefined") return "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge";
    return null;
  }

  function microphoneConstraints(): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (selectedInputDeviceId.value) constraints.deviceId = { exact: selectedInputDeviceId.value };
    return constraints;
  }

  async function refreshAudioDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      inputDevices.length = 0;
      outputDevices.length = 0;
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    const speakers = devices
      .filter((device) => device.kind === "audiooutput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    inputDevices.splice(0, inputDevices.length, ...microphones);
    outputDevices.splice(0, outputDevices.length, ...speakers);
    if (selectedInputDeviceId.value && !microphones.some((device) => device.deviceId === selectedInputDeviceId.value)) {
      selectedInputDeviceId.value = "";
      localStorage.setItem("webspeak:input-device", selectedInputDeviceId.value);
      void saveAudioPreferences();
      if (micStream) void startMicrophone().catch(() => undefined);
    }
    if (selectedOutputDeviceId.value && !speakers.some((device) => device.deviceId === selectedOutputDeviceId.value)) {
      selectedOutputDeviceId.value = "";
      localStorage.setItem("webspeak:output-device", "");
      void saveAudioPreferences();
      if (audioCtx && outputDeviceSupported.value) void setAudioSink(audioCtx, "").catch(() => undefined);
    }
  }

  async function refreshInputDevices(): Promise<void> {
    await refreshAudioDevices();
  }

  async function startMicrophone(): Promise<void> {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    // Acquire the replacement stream before tearing down the current graph so
    // changing devices does not interrupt an active microphone on failure.
    let nextStream: MediaStream;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
      audioPermission.value = "granted";
    } catch (error) {
      if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) audioPermission.value = "denied";
      throw error;
    }
    stopMicrophone(false);
    micStream = nextStream;

    micSource = ctx.createMediaStreamSource(micStream);
    micGain = ctx.createGain();
    micGain.gain.value = inputVolume.value;
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    const handleCaptureChunk = (input: Float32Array, rms?: number): void => {
      if (!input.length) return;
      micLevel.value = Math.min(1, (rms ?? Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length)) * 6);
      const socket = ws.value;
      const shouldSend = !microphoneMuted.value
        && !microphoneTestActive.value
        && !webrtcActive.value
        && socket?.readyState === WebSocket.OPEN
        && voxGate(input);
      if (!shouldSend) {
        accumLen = 0;
        if (microphoneMuted.value) {
          voxAttack = 0;
          voxRelease = 0;
        }
        return;
      }
      if (!socket) {
        accumLen = 0;
        return;
      }
      const bufferedBytes = socket.bufferedAmount;
      if (bufferedBytes > MAX_AUDIO_BUFFERED_BYTES) {
        accumLen = 0;
        return;
      }

      if (convBuf.length < input.length) convBuf = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]!));
        convBuf[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const need = accumLen + input.length;
      if (accumBuf.length < need) accumBuf = new Int16Array(Math.max(need, accumBuf.length * 2));
      accumBuf.set(convBuf.subarray(0, input.length), accumLen);
      accumLen = need;

      let offset = 0;
      while (offset + AUDIO_FRAME_SAMPLES <= accumLen && socket.readyState === WebSocket.OPEN && socket.bufferedAmount <= MAX_AUDIO_BUFFERED_BYTES) {
        socket.send(accumBuf.slice(offset, offset + AUDIO_FRAME_SAMPLES).buffer);
        offset += AUDIO_FRAME_SAMPLES;
      }
      if (offset > 0) markSpeaking(state.tsClientId);
      accumLen -= offset;
      if (offset > 0) accumBuf.set(accumBuf.subarray(offset, offset + accumLen), 0);
    };

    if (typeof AudioWorkletNode !== "undefined" && ctx.audioWorklet) {
      try {
        if (workletContext !== ctx || !workletModulePromise) {
          workletContext = ctx;
          workletModulePromise = ctx.audioWorklet.addModule(micCaptureWorkletUrl);
        }
        await workletModulePromise;
        workletNode = new AudioWorkletNode(ctx, "webspeak-mic-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        workletNode.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; rms?: number }>) => {
          const samples = event.data?.samples;
          if (samples instanceof Float32Array) handleCaptureChunk(samples, event.data.rms);
        };
      } catch {
        workletNode?.disconnect();
        workletNode = null;
        workletContext = null;
        workletModulePromise = null;
      }
    }

    if (!workletNode) {
      scriptNode = ctx.createScriptProcessor(1024, 1, 1);
      scriptNode.onaudioprocess = (event) => handleCaptureChunk(event.inputBuffer.getChannelData(0));
    }

    micSource.connect(micGain);
    const captureNode = workletNode ?? scriptNode!;
    micGain.connect(captureNode);
    captureNode.connect(silentGain);
    silentGain.connect(ctx.destination);
    await refreshAudioDevices();
  }

  async function ensureMicrophone(): Promise<void> {
    if (micStream) return;
    if (!microphoneStartPromise) {
      microphoneStartPromise = startMicrophone().finally(() => {
        microphoneStartPromise = null;
      });
    }
    await microphoneStartPromise;
  }

  function voxGate(samples: Float32Array): boolean {
    let sum = 0;
    const count = Math.min(256, samples.length);
    for (let i = 0; i < count; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / count);
    if (rms >= voxThreshold.value) {
      voxAttack = Math.min(VOX_ATTACK_FRAMES, voxAttack + 1);
      voxRelease = VOX_HOLD;
      return voxAttack >= VOX_ATTACK_FRAMES;
    }
    voxAttack = 0;
    if (voxRelease > 0) {
      voxRelease--;
      return true;
    }
    return false;
  }

  function stopWebRtcMix(): void {
    webrtcMixAccompanimentSource?.disconnect();
    webrtcMixMicSource?.disconnect();
    webrtcMixMicGain?.disconnect();
    webrtcMixDestination?.disconnect();
    webrtcMixAccompanimentSource = null;
    webrtcMixMicSource = null;
    webrtcMixMicGain = null;
    webrtcMixDestination = null;
  }

  function releaseAccompanimentStream(): void {
    accompanimentStream?.getTracks().forEach((track) => track.stop());
    accompanimentStream = null;
    accompanimentActive.value = false;
  }

  function createWebRtcMixStream(): MediaStream {
    if (!micStream) throw new Error("没有可用的麦克风音轨");
    const ctx = getAudioCtx();
    stopWebRtcMix();
    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";
    const microphoneSource = ctx.createMediaStreamSource(micStream);
    const microphoneGain = ctx.createGain();
    microphoneGain.gain.value = microphoneMuted.value ? 0 : inputVolume.value;
    microphoneSource.connect(microphoneGain);
    microphoneGain.connect(destination);

    webrtcMixDestination = destination;
    webrtcMixMicSource = microphoneSource;
    webrtcMixMicGain = microphoneGain;

    const accompanimentTrack = accompanimentStream?.getAudioTracks()[0];
    if (accompanimentTrack) {
      const accompanimentSource = ctx.createMediaStreamSource(accompanimentStream!);
      // Keep the captured application audio at its source level. Do not add
      // a fixed attenuation/gain node: it makes music sound quieter than the
      // source and encourages later "compensation" steps to pump its volume.
      accompanimentSource.connect(destination);
      webrtcMixAccompanimentSource = accompanimentSource;
    }
    return destination.stream;
  }

  async function replaceWebRtcAudioTrack(): Promise<void> {
    if (!webrtcPeer || !micStream) return;
    const sender = webrtcPeer.getSenders().find((candidate) => candidate.track?.kind === "audio");
    if (!sender) throw new Error("WebRTC 音频轨道尚未就绪");
    const mixedStream = createWebRtcMixStream();
    const mixedTrack = mixedStream.getAudioTracks()[0];
    if (!mixedTrack) throw new Error("混合音频轨道创建失败");
    await sender.replaceTrack(mixedTrack);
  }

  async function startAccompaniment(): Promise<void> {
    accompanimentErrorCode.value = "";
    if (!accompanimentSupported.value) {
      accompanimentErrorCode.value = "unsupported";
      throw new Error("伴奏共享不可用");
    }
    if (!webrtcActive.value || !webrtcPeer || !micStream) {
      accompanimentErrorCode.value = "needsWebRtc";
      throw new Error("伴奏功能需要启用 WebRTC");
    }

    const captureProcessingConstraints: MediaTrackConstraints = {
      // Display/application audio must not pass through browser voice
      // processing. Those processors are designed for speech and can change
      // music level from frame to frame (AGC), suppress quiet passages, or
      // cancel sustained tones.
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    };
    const audioConstraints = { ...captureProcessingConstraints } as MediaTrackConstraints & { restrictOwnAudio?: boolean };
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints?.() as Record<string, boolean> | undefined;
    if (supportedConstraints?.restrictOwnAudio) audioConstraints.restrictOwnAudio = true;
    const options = {
      video: { displaySurface: "browser" },
      audio: audioConstraints,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
      windowAudio: "window",
    } as unknown as DisplayMediaStreamOptions;

    let nextStream: MediaStream;
    try {
      nextStream = await navigator.mediaDevices.getDisplayMedia(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      accompanimentErrorCode.value = "permission";
      throw error;
    }
    const audioTrack = nextStream.getAudioTracks()[0];
    nextStream.getVideoTracks().forEach((track) => track.stop());
    if (!audioTrack) {
      nextStream.getTracks().forEach((track) => track.stop());
      accompanimentErrorCode.value = "noAudio";
      throw new Error("所选来源没有可共享音频");
    }

    try {
      // Do not pass the Chromium-only restrictOwnAudio hint to
      // applyConstraints: rejecting an unknown key could otherwise cause the
      // browser to discard all three standard processing-off constraints.
      await audioTrack.applyConstraints(captureProcessingConstraints);
    } catch {
      // Some browsers expose display audio but reject one or more optional
      // processing constraints. The capture can still proceed without
      // introducing a WebSpeak-side gain stage.
    }
    if ("contentHint" in audioTrack) audioTrack.contentHint = "music";

    accompanimentStream?.getTracks().forEach((track) => track.stop());
    accompanimentStream = nextStream;
    accompanimentActive.value = true;
    sendCmd("setAccompanimentActive", { active: true });
    audioTrack.addEventListener("ended", () => { void stopAccompaniment(); }, { once: true });
    try {
      await replaceWebRtcAudioTrack();
    } catch (error) {
      releaseAccompanimentStream();
      sendCmd("setAccompanimentActive", { active: false });
      stopWebRtcMix();
      accompanimentErrorCode.value = "permission";
      throw error;
    }
  }

  async function stopAccompaniment(): Promise<void> {
    accompanimentErrorCode.value = "";
    releaseAccompanimentStream();
    if (webrtcActive.value) sendCmd("setAccompanimentActive", { active: false });
    if (webrtcActive.value && webrtcPeer && micStream) await replaceWebRtcAudioTrack();
    else stopWebRtcMix();
  }

  async function startWebRtcTransport(sequence: number, socket: WebSocket): Promise<void> {
    if (typeof RTCPeerConnection === "undefined") throw new Error("当前浏览器不支持 WebRTC");
    await ensureMicrophone();
    if (sequence !== connectionSequence || socket.readyState !== WebSocket.OPEN || !micStream) return;
    const microphoneTrack = micStream.getAudioTracks()[0];
    if (!microphoneTrack) throw new Error("没有可用的麦克风音轨");

    stopCaptureGraph();
    const peer = new RTCPeerConnection({ iceServers: [] });
    webrtcPeer = peer;
    webrtcFallbackStarted = false;
    microphoneTrack.enabled = !microphoneMuted.value;
    const mixedStream = createWebRtcMixStream();
    const mixedTrack = mixedStream.getAudioTracks()[0];
    if (!mixedTrack) throw new Error("混合音频轨道创建失败");
    peer.addTrack(mixedTrack, mixedStream);
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      // Use the browser's native WebRTC media output. Routing the remote
      // track through AudioContext made playback depend on autoplay policy:
      // the control channel could report speaking while a suspended context
      // silently discarded the actual audio. A hidden autoplaying media
      // element keeps WebRTC's decoder and jitter buffer on the native path.
      stopWebRtcPlayback();
      const output = document.createElement("audio") as SinkAudioElement;
      output.autoplay = true;
      output.muted = false;
      output.setAttribute("playsinline", "");
      output.volume = effectiveOutputVolume();
      output.setAttribute("aria-hidden", "true");
      output.tabIndex = -1;
      output.style.position = "fixed";
      output.style.width = "1px";
      output.style.height = "1px";
      output.style.opacity = "0";
      output.style.pointerEvents = "none";
      output.srcObject = stream;
      document.body.append(output);
      webrtcOutputElement = output;
      webrtcPlaybackStream = stream;
      if (selectedOutputDeviceId.value && output.setSinkId) {
        void output.setSinkId(selectedOutputDeviceId.value).catch(() => undefined);
      }
      void syncWebRtcPlayback();
    };
    startWebRtcMicMonitor(getAudioCtx(), micStream, microphoneTrack);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") void fallbackFromWebRtc(sequence, socket);
    };

    const negotiation = (async () => {
      webrtcActive.value = true;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      if (sequence !== connectionSequence || webrtcPeer !== peer || socket.readyState !== WebSocket.OPEN) return;
      const description = peer.localDescription;
      if (!description) throw new Error("WebRTC offer was not created");
      socket.send(JSON.stringify({ type: "webrtcOffer", payload: {
        sdp: { type: description.type, sdp: description.sdp },
        muted: microphoneMuted.value,
        accompanimentActive: accompanimentActive.value,
      } }));
      window.setTimeout(() => {
        if (webrtcPeer === peer && !peer.remoteDescription) void fallbackFromWebRtc(sequence, socket);
      }, 8_000);
    })();
    webrtcNegotiationPromise = negotiation;
    try {
      await negotiation;
    } catch (error) {
      if (webrtcPeer === peer) await fallbackFromWebRtc(sequence, socket);
      throw error;
    } finally {
      if (webrtcNegotiationPromise === negotiation) webrtcNegotiationPromise = null;
    }
  }

  async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const timer = window.setTimeout(finish, 5_000);
      peer.addEventListener("icegatheringstatechange", onStateChange);
    });
  }

  async function applyWebRtcAnswer(description: unknown): Promise<void> {
    if (!webrtcPeer || !isSessionDescription(description, "answer")) return;
    try {
      await webrtcPeer.setRemoteDescription(description);
      webrtcActive.value = true;
      syncWebRtcMemberVolumes();
    } catch {
      if (lastConnection && ws.value) await fallbackFromWebRtc(connectionSequence, ws.value);
    }
  }

  async function fallbackFromWebRtc(sequence: number, socket: WebSocket): Promise<void> {
    if (sequence !== connectionSequence || webrtcFallbackStarted) return;
    webrtcFallbackStarted = true;
    webrtcActive.value = false;
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "webrtcStop" }));
    stopWebRtcTransport();
    if (socket.readyState === WebSocket.OPEN && state.connected) {
      try { await startMicrophone(); } catch (error: unknown) {
        state.error = `麦克风访问失败：${error instanceof Error ? error.message : "请检查浏览器权限"}`;
      }
    }
  }

  function stopWebRtcTransport(): void {
    const peer = webrtcPeer;
    webrtcPeer = null;
    webrtcActive.value = false;
    webrtcNegotiationPromise = null;
    releaseAccompanimentStream();
    stopWebRtcMix();
    stopWebRtcMicMonitor();
    stopWebRtcPlayback();
    if (peer) void peer.close();
  }

  function stopWebRtcPlayback(): void {
    webrtcPlaybackRetryCleanup?.();
    webrtcPlaybackStream = null;
    webrtcOutputElement?.pause();
    if (webrtcOutputElement) {
      webrtcOutputElement.srcObject = null;
      webrtcOutputElement.remove();
    }
    webrtcOutputElement = null;
  }

  function startWebRtcMicMonitor(ctx: AudioContext, stream: MediaStream, track: MediaStreamTrack): void {
    stopWebRtcMicMonitor(false);
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(ctx.destination);
      const samples = new Float32Array(analyser.fftSize);
      webrtcMicMonitorSource = source;
      webrtcMicMonitorAnalyser = analyser;
      webrtcMicMonitorGain = silent;
      webrtcMicMonitorTimer = setInterval(() => {
        if (!webrtcMicMonitorAnalyser) return;
        webrtcMicMonitorAnalyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        micLevel.value = Math.min(1, rms * 6);
        if (!microphoneMuted.value && track.enabled && rms >= voxThreshold.value) markSpeaking(state.tsClientId);
        else if (state.tsClientId) clearSpeaking(state.tsClientId);
      }, 50);
    } catch {
      stopWebRtcMicMonitor(false);
    }
  }

  function stopWebRtcMicMonitor(resetLevel = true): void {
    if (webrtcMicMonitorTimer) clearInterval(webrtcMicMonitorTimer);
    webrtcMicMonitorTimer = null;
    webrtcMicMonitorSource?.disconnect();
    webrtcMicMonitorAnalyser?.disconnect();
    webrtcMicMonitorGain?.disconnect();
    webrtcMicMonitorSource = null;
    webrtcMicMonitorAnalyser = null;
    webrtcMicMonitorGain = null;
    if (resetLevel) micLevel.value = 0;
  }

  function isSessionDescription(value: unknown, type: "answer"): value is RTCSessionDescriptionInit {
    return Boolean(value) && typeof value === "object"
      && (value as { type?: unknown }).type === type
      && typeof (value as { sdp?: unknown }).sdp === "string";
  }

  function stopCaptureGraph(): void {
    accumLen = 0;
    voxAttack = 0;
    voxRelease = 0;
    micLevel.value = 0;
    scriptNode?.disconnect();
    workletNode?.port.close();
    workletNode?.disconnect();
    micGain?.disconnect();
    micSource?.disconnect();
    silentGain?.disconnect();
    scriptNode = null;
    workletNode = null;
    micGain = null;
    micSource = null;
    silentGain = null;
  }

  function stopMicrophone(closeContext = true): void {
    stopCaptureGraph();
    releaseAccompanimentStream();
    stopWebRtcMix();
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    if (closeContext) {
      audioCtx?.close();
      audioCtx = null;
      workletContext = null;
      workletModulePromise = null;
    }
  }

  async function prepareInputDevices(): Promise<void> {
    if (!micStream) await startMicrophone();
    else await refreshAudioDevices();
  }

  async function setInputDevice(deviceId: string): Promise<void> {
    const previousDeviceId = selectedInputDeviceId.value;
    const shouldRestartWebRtc = webrtcActive.value && Boolean(ws.value);
    selectedInputDeviceId.value = deviceId;
    localStorage.setItem("webspeak:input-device", deviceId);
    void saveAudioPreferences();
    try {
      if (shouldRestartWebRtc) stopWebRtcTransport();
      if (micStream) await startMicrophone();
      if (shouldRestartWebRtc && ws.value) {
        stopWebRtcTransport();
        await startWebRtcTransport(connectionSequence, ws.value);
      }
      await refreshAudioDevices();
    } catch (error) {
      selectedInputDeviceId.value = previousDeviceId;
      localStorage.setItem("webspeak:input-device", previousDeviceId);
      throw error;
    }
  }

  async function startMicrophoneTest(): Promise<void> {
    microphoneTestActive.value = true;
    if (testAudioUrl.value) {
      URL.revokeObjectURL(testAudioUrl.value);
      testAudioUrl.value = "";
    }
    try {
      await prepareInputDevices();
      if (typeof MediaRecorder !== "undefined" && micStream) {
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(micStream);
        testRecorder = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          if (chunks.length) {
            testAudioUrl.value = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          }
          if (testRecorder === recorder) testRecorder = null;
        };
        recorder.start();
        testRecorderTimer = setTimeout(() => stopMicrophoneTest(), 5_000);
      }
    } catch (error) {
      microphoneTestActive.value = false;
      throw error;
    }
  }

  function stopMicrophoneTest(): void {
    microphoneTestActive.value = false;
    if (testRecorderTimer) clearTimeout(testRecorderTimer);
    testRecorderTimer = null;
    if (testRecorder && testRecorder.state !== "inactive") testRecorder.stop();
    if (!state.connected) stopMicrophone();
  }

  async function setOutputDevice(deviceId: string): Promise<void> {
    const previousDeviceId = selectedOutputDeviceId.value;
    if (deviceId && !outputDevices.some((device) => device.deviceId === deviceId)) {
      throw new Error("所选扬声器当前不可用");
    }
    selectedOutputDeviceId.value = deviceId;
    localStorage.setItem("webspeak:output-device", deviceId);
    try {
      await setAudioSink(getAudioCtx(), deviceId);
      await saveAudioPreferences();
    } catch (error) {
      selectedOutputDeviceId.value = previousDeviceId;
      localStorage.setItem("webspeak:output-device", previousDeviceId);
      throw error;
    }
  }

  function playNotification(kind: "connected" | "disconnected" | "poke" | "private" | "reconnectFailed"): void {
    if (notificationVolume.value <= 0 || outputMuted.value || effectiveOutputVolume() <= 0 || typeof window === "undefined") return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") return;
      const frequencies: Record<typeof kind, number[]> = {
        connected: [660, 880],
        disconnected: [440, 330],
        poke: [740, 980],
        private: [600, 760],
        reconnectFailed: [300, 220],
      };
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      oscillator.frequency.setValueAtTime(frequencies[kind][0], now);
      oscillator.frequency.setValueAtTime(frequencies[kind][1], now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, notificationVolume.value * effectiveOutputVolume() * 0.12), now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch {
      // Notification sounds are best effort and must never affect the session.
    }
  }

  function playAudioFrame(clientId: number, opusData: Uint8Array): void {
    if (opusData.length < 3) return;
    let decoder = remoteDecoders.get(clientId);
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const scheduledUntil = remotePlayTimes.get(clientId) ?? now;
    const decodeQueueSize = decoder?.decodeQueueSize ?? 0;
    if (
      decoder &&
      (scheduledUntil > now + MAX_REMOTE_PLAY_AHEAD_SECONDS || decodeQueueSize >= MAX_REMOTE_DECODE_QUEUE_FRAMES)
    ) {
      resetRemotePlayback(clientId);
      decoder = undefined;
    }

    if (!decoder) {
      const gainNode = ctx.createGain();
      gainNode.gain.value = (volumes[clientId] ?? 1) * effectiveOutputVolume();
      gainNode.connect(ctx.destination);
      remoteGains.set(clientId, gainNode);
      const generation = ++nextRemoteDecoderGeneration;
      const nextDecoder = new AudioDecoder({
        output: (chunk: AudioData) => {
          if (remoteDecoderGenerations.get(clientId) !== generation) {
            chunk.close();
            return;
          }
          try {
            const { sampleRate, numberOfChannels, numberOfFrames } = chunk;
            const buffer = ctx.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
            for (let ch = 0; ch < numberOfChannels; ch++) {
              const data = new Float32Array(numberOfFrames);
              chunk.copyTo(data, { planeIndex: ch, format: "f32-planar" });
              buffer.copyToChannel(data, ch);
            }
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            let sources = remotePlaybackSources.get(clientId);
            if (!sources) {
              sources = new Set<AudioBufferSourceNode>();
              remotePlaybackSources.set(clientId, sources);
            }
            sources.add(source);
            source.addEventListener("ended", () => {
              source.disconnect();
              sources?.delete(source);
              if (sources?.size === 0) remotePlaybackSources.delete(clientId);
            }, { once: true });
            let playTime = remotePlayTimes.get(clientId) ?? ctx.currentTime;
            if (playTime < ctx.currentTime) playTime = ctx.currentTime;
            if (playTime + numberOfFrames / sampleRate > ctx.currentTime + MAX_REMOTE_PLAY_AHEAD_SECONDS) {
              source.disconnect();
              sources.delete(source);
              if (sources.size === 0) remotePlaybackSources.delete(clientId);
              chunk.close();
              resetRemotePlayback(clientId);
              return;
            }
            source.start(playTime);
            remotePlayTimes.set(clientId, playTime + numberOfFrames / sampleRate);
          } catch {
            // A decoder can finish while the audio context is being torn down.
          }
          chunk.close();
        },
        error: () => {
          if (remoteDecoderGenerations.get(clientId) === generation) {
            remoteDecoderGenerations.delete(clientId);
            remoteDecoders.delete(clientId);
          }
        },
      });
      nextDecoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });
      decoder = nextDecoder;
      remoteDecoderGenerations.set(clientId, generation);
      remoteDecoders.set(clientId, decoder);
    }

    try {
      const timestamp = remoteDecodeTimestamps.get(clientId) ?? 0;
      decoder.decode(new EncodedAudioChunk({ type: "key", timestamp, duration: 20_000, data: opusData }));
      remoteDecodeTimestamps.set(clientId, timestamp + 20_000);
    } catch {
      // Ignore malformed frames; the next valid frame can still be decoded.
    }
  }

  function clearRemotePlayback(clientId: number): void {
    const decoder = remoteDecoders.get(clientId);
    if (decoder) {
      try { decoder.close(); } catch { /* already closed */ }
    }
    remoteDecoders.delete(clientId);
    remoteDecoderGenerations.delete(clientId);
    remotePlayTimes.delete(clientId);
    remoteDecodeTimestamps.delete(clientId);
    const sources = remotePlaybackSources.get(clientId);
    if (sources) {
      for (const source of sources) {
        try { source.stop(); } catch { /* already ended */ }
        source.disconnect();
      }
      remotePlaybackSources.delete(clientId);
    }
  }

  function resetRemotePlayback(clientId: number): void {
    clearRemotePlayback(clientId);
  }

  function connect(target: string, channel: string, nickname: string, serverPassword = "", identity = "", rememberIdentity = false, inviteToken = ""): void {
    disconnect(true);
    lastConnection = { target, channel, nickname, serverPassword, ...(identity ? { identity } : {}), rememberIdentity };
    identityMaterial.value = identity;
    const sequence = ++connectionSequence;
    state.error = "";
    state.errorCode = "";
    state.connecting = true;
    state.reconnecting = false;
    state.reconnectAttempt = 0;
    state.reconnectFailed = false;
    void openTicketedConnection(sequence, target, channel, nickname, serverPassword, inviteToken);
  }

  async function openTicketedConnection(sequence: number, target: string, channel: string, nickname: string, serverPassword: string, inviteToken: string): Promise<void> {
    try {
      const response = await fetch("/api/join-ticket", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ target, nickname, channel, serverPassword, ...(inviteToken ? { invite: inviteToken } : {}), ...(lastConnection?.rememberIdentity && lastConnection.identity ? { identity: lastConnection.identity } : {}), ...(lastConnection?.rememberIdentity ? { rememberIdentity: true } : {}) }),
      });
      const result = await response.json().catch(() => ({})) as { ticket?: unknown; code?: unknown };
      if (!response.ok || typeof result.ticket !== "string") {
        throw new Error(joinTicketReason(typeof result.code === "string" ? result.code : ""));
      }
      if (sequence !== connectionSequence) return;
      openVoiceSocket(sequence, result.ticket);
    } catch (error: unknown) {
      if (sequence !== connectionSequence) return;
      state.connecting = false;
      state.error = error instanceof Error ? error.message : "连接服务器失败，请检查邀请链接或服务器状态";
    }
  }

  function openVoiceSocket(sequence: number, ticket: string): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws/voice?ticket=${encodeURIComponent(ticket)}`);
    socket.binaryType = "arraybuffer";
    ws.value = socket;
    socket.onopen = () => {
      if (sequence !== connectionSequence) {
        socket.close(1000);
        return;
      }
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          handleMessage(JSON.parse(event.data));
        } catch {
          // Ignore malformed control frames.
        }
      } else {
        handleAudioFrame(new Uint8Array(event.data));
      }
    };
    socket.onclose = (event) => {
      if (sequence !== connectionSequence) return;
      state.connected = false;
      state.connecting = false;
      state.reconnecting = false;
      // Prefer the close code over the generic WebSocket error event. The
      // gateway uses a dedicated code when a remembered identity is already
      // active in another browser page.
      if (event.code !== 1000 && !state.reconnectFailed) state.error = closeReason(event.code);
      stopWebRtcTransport();
      stopMicrophone();
      whisperTargetIds.clear();
      whisperActive.value = false;
    };
    socket.onerror = () => {
      // The following close event contains the actionable close code. Do not
      // overwrite it with a generic browser WebSocket error first.
    };
  }

  function joinTicketReason(code: string): string {
    if (code === "NOT_INITIALIZED") return "WebSpeak 尚未完成首次配置";
    if (code === "TARGET_NOT_ALLOWED") return "此 TeamSpeak 服务器地址不允许连接";
    if (code === "INVALID_NICKNAME") return "请输入有效的昵称";
    if (code === "INVITE_INVALID") return "邀请链接已失效或已被撤销";
    return "连接服务器失败，请检查邀请链接或服务器状态";
  }

  function closeReason(code: number): string {
    if (code === 4002) return "TeamSpeak 服务器地址无效";
    if (code === 4003) return "TeamSpeak 服务器连接失败";
    if (code === 4004) return "服务器当前已满，请稍后重试";
    if (code === 4005) return "此 TeamSpeak 身份已在另一个浏览器页面使用，请关闭另一条连接或取消“保持身份”后重试";
    return "连接已断开";
  }

  function disconnect(preserveConnection = false): void {
    connectionSequence++;
    const keepRememberedIdentity = lastConnection?.rememberIdentity === true;
    if (!preserveConnection) lastConnection = null;
    stopMicrophone();
    const socket = ws.value;
    ws.value = null;
    stopWebRtcTransport();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
    state.connected = false;
    state.connecting = false;
    state.reconnecting = false;
    state.reconnectAttempt = 0;
    state.reconnectFailed = false;
    state.tsClientId = 0;
    state.errorCode = "";
    state.channelSwitchedChannelId = "";
    if (!keepRememberedIdentity) identityMaterial.value = "";
    members.length = 0;
    channels.length = 0;
    chatMessages.length = 0;
    for (const clientId of new Set([...remoteDecoders.keys(), ...remotePlaybackSources.keys()])) clearRemotePlayback(clientId);
    remoteDecoderGenerations.clear();
    remotePlayTimes.clear();
    remoteDecodeTimestamps.clear();
    for (const gain of remoteGains.values()) gain.disconnect();
    remoteGains.clear();
    clearSpeakingState();
    whisperTargetIds.clear();
    whisperActive.value = false;
    for (const key of Object.keys(volumes)) delete volumes[Number(key)];
  }

  function handleMessage(msg: any): void {
    switch (msg.type) {
      case "connected":
        const wasReconnecting = state.reconnecting;
        state.connected = true;
        state.connecting = false;
        state.reconnecting = false;
        state.reconnectAttempt = 0;
        state.reconnectFailed = false;
        state.error = "";
        state.errorCode = "";
        state.channelSwitchedChannelId = "";
        state.tsClientId = Number(msg.tsClientId) || 0;
        applyWhisperState(msg.whisperTargetIds, msg.whisperActive);
        if (Array.isArray(msg.members)) {
          members.length = 0;
          for (const member of msg.members) {
            members.push({ ...member, isSelf: Number(member.id) === state.tsClientId });
          }
          syncKnownMemberVolumes();
        }
        serverEvents.length = 0;
        if (Array.isArray(msg.serverEventLog)) serverEvents.push(...msg.serverEventLog);
        if (typeof msg.identity === "string" && msg.identity.length <= 8192) {
          identityMaterial.value = msg.identity;
          if (lastConnection) lastConnection.identity = msg.identity;
        }
        if (wasReconnecting) {
          const start = msg.webrtcAvailable === true && typeof RTCPeerConnection !== "undefined"
            ? (ws.value ? startWebRtcTransport(connectionSequence, ws.value) : Promise.resolve())
            : ensureMicrophone();
          start.catch((error: unknown) => {
            state.error = `麦克风访问失败：${error instanceof Error ? error.message : "请检查浏览器权限"}`;
          });
        } else if (msg.webrtcAvailable === true && typeof RTCPeerConnection !== "undefined" && ws.value) {
          void startWebRtcTransport(connectionSequence, ws.value).catch((error: unknown) => {
            state.error = `麦克风访问失败：${error instanceof Error ? error.message : "请检查浏览器权限"}`;
          });
        } else {
          void ensureMicrophone().catch((error: unknown) => {
            state.error = `麦克风访问失败：${error instanceof Error ? error.message : "请检查浏览器权限"}`;
          });
        }
        break;
      case "memberEnter":
        if (!members.some((member) => member.id === msg.id)) {
          members.push({ id: msg.id, nickname: msg.nickname, uid: typeof msg.uid === "string" ? msg.uid : undefined, isSelf: Boolean(msg.isSelf) });
          syncKnownMemberVolumes();
        }
        break;
      case "memberLeave": {
        const clientId = Number(msg.id);
        clearSpeaking(clientId);
        clearRemotePlayback(clientId);
        const index = members.findIndex((member) => member.id === clientId);
        if (index >= 0) members.splice(index, 1);
        break;
      }
      case "channelList":
        channels.length = 0;
        if (Array.isArray(msg.channels)) {
          for (const channel of msg.channels) channels.push(channel);
        }
        syncKnownMemberVolumes();
        break;
      case "chatMessage":
        if (Number(msg.invokerId) === state.tsClientId) break;
        const incomingScope = msg.scope === "private" || msg.scope === "server" || msg.scope === "channel" ? msg.scope : "system";
        const rawTargetId = typeof msg.targetId === "string" || typeof msg.targetId === "number" ? String(msg.targetId) : undefined;
        // Older gateways and TeamSpeak channel notifications may use 0 as
        // the broadcast sentinel. It must not be compared with a channel id.
        const incomingTargetId = rawTargetId && rawTargetId !== "0" ? rawTargetId : undefined;
        chatMessages.push({
          id: `remote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          scope: incomingScope,
          ...(incomingTargetId ? { targetId: incomingTargetId } : {}),
          ...(incomingScope === "private" ? { conversationId: String(Number(msg.invokerId) || 0) } : {}),
          senderId: Number(msg.invokerId) || undefined,
          senderUid: typeof msg.senderUid === "string" ? msg.senderUid : undefined,
          invokerName: String(msg.invokerName || "Unknown"),
          message: String(msg.message || ""),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });
        break;
      case "serverEvent":
        if (msg.event && typeof msg.event.id === "string") serverEvents.push(msg.event as ServerEvent);
        break;
      case "pokeReceived":
        pokeNotifications.push({
          id: `poke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          invokerId: Number(msg.invokerId) || 0,
          invokerUid: typeof msg.invokerUid === "string" ? msg.invokerUid : "",
          invokerName: String(msg.invokerName || "Unknown"),
          message: String(msg.message || ""),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });
        break;
      case "channelSwitched":
        state.channelSwitchedChannelId = typeof msg.channelId === "string" || typeof msg.channelId === "number" ? String(msg.channelId) : "";
        state.error = "";
        state.errorCode = "";
        break;
      case "disconnected":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = Boolean(msg.recoverable !== false);
        state.reconnectFailed = false;
        if (!state.reconnecting) state.error = "TeamSpeak 连接已断开";
        stopWebRtcTransport();
        stopMicrophone();
        whisperTargetIds.clear();
        whisperActive.value = false;
        break;
      case "reconnecting":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = true;
        state.reconnectFailed = false;
        state.reconnectAttempt = Number(msg.attempt) || state.reconnectAttempt + 1;
        stopWebRtcTransport();
        stopMicrophone();
        whisperTargetIds.clear();
        whisperActive.value = false;
        break;
      case "reconnected":
        state.reconnecting = false;
        state.reconnectFailed = false;
        break;
      case "reconnectFailed":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = false;
        state.reconnectFailed = true;
        state.error = "连接已中断，无法自动恢复";
        whisperTargetIds.clear();
        whisperActive.value = false;
        break;
      case "whisperTargets":
        applyWhisperState(msg.targetIds, msg.active);
        break;
      case "webrtcAnswer":
        void applyWebRtcAnswer(msg.payload?.sdp);
        break;
      case "webrtcError":
        if (ws.value) void fallbackFromWebRtc(connectionSequence, ws.value);
        break;
      case "voiceActivity":
        if (Array.isArray(msg.clientIds)) {
          for (const clientId of msg.clientIds) {
            if (typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0) markSpeaking(clientId);
          }
        }
        break;
      case "error":
        state.errorCode = String(msg.error?.code || "");
        state.error = protocolErrorMessage(state.errorCode, String(msg.error?.message || msg.message || "操作失败"));
        break;
    }
  }

  function handleAudioFrame(data: Uint8Array): void {
    // WebRTC carries the realtime downlink after negotiation. Ignore any
    // in-flight fallback WebSocket packets so a transport switch cannot
    // produce duplicate or delayed playback.
    if (webrtcActive.value) return;
    if (data.length < 4) return;
    const clientId = (data[1] << 8) | data[2];
    if (clientId === state.tsClientId) return;
    markSpeaking(clientId);
    playAudioFrame(clientId, data.slice(3));
  }

  function sendCmd(type: string, payload: Record<string, unknown> = {}): void {
    if (ws.value?.readyState === WebSocket.OPEN) ws.value.send(JSON.stringify({ type, payload }));
  }

  function switchChannel(channelId: string, password = ""): void {
    state.error = "";
    state.errorCode = "";
    state.channelSwitchedChannelId = "";
    sendCmd("switchChannel", { channelId, ...(password ? { password } : {}) });
  }

  function sendTextMessage(message: string, targetId = ""): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd("sendTextMessage", { message: trimmed });
    chatMessages.push({
      id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      scope: "channel",
      ...(targetId ? { targetId } : {}),
      senderId: state.tsClientId,
      invokerName: "你",
      message: trimmed,
      timestamp: Date.now(),
      isSelf: true,
    });
  }

  function sendServerMessage(message: string): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd("sendServerMessage", { message: trimmed });
    chatMessages.push({ id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, scope: "server", senderId: state.tsClientId, invokerName: "你", message: trimmed, timestamp: Date.now(), isSelf: true });
  }

  function sendPrivateMessage(clientId: number, message: string, targetId = ""): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd("sendPrivateMessage", { clientId, message: trimmed });
    chatMessages.push({ id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, scope: "private", targetId, conversationId: String(clientId), senderId: state.tsClientId, invokerName: "你", message: trimmed, timestamp: Date.now(), isSelf: true });
  }

  function sendPoke(clientId: number, message = ""): void {
    sendCmd("poke", { clientId, message: message.trim().slice(0, 200) });
  }

  function setAway(away: boolean, message = ""): void {
    sendCmd("setAway", { away, message: message.trim().slice(0, 200) });
  }

  function setWhisperTargets(clientIds: number[]): void {
    const targets = [...new Set(clientIds)].filter((clientId) => Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== state.tsClientId).slice(0, 8);
    whisperTargetIds.clear();
    for (const clientId of targets) whisperTargetIds.add(clientId);
    if (!targets.length) whisperActive.value = false;
    sendCmd("setWhisperTargets", { targetIds: targets });
  }

  function setWhisperActive(active: boolean): void {
    if (active && !whisperTargetIds.size) return;
    whisperActive.value = active;
    sendCmd("setWhisperActive", { active });
  }

  function applyWhisperState(targetIds: unknown, active: unknown): void {
    whisperTargetIds.clear();
    if (Array.isArray(targetIds)) {
      for (const clientId of targetIds) {
        if (typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== state.tsClientId) whisperTargetIds.add(clientId);
      }
    }
    whisperActive.value = active === true && whisperTargetIds.size > 0;
  }

  function reconnectNow(): void {
    if (!lastConnection || state.connecting) return;
    connect(lastConnection.target, lastConnection.channel, lastConnection.nickname, lastConnection.serverPassword, lastConnection.rememberIdentity ? identityMaterial.value || lastConnection.identity : "", lastConnection.rememberIdentity);
  }

  function setMicrophoneMuted(muted: boolean): void {
    microphoneMuted.value = muted;
    voxAttack = 0;
    voxRelease = 0;
    accumLen = 0;
    if (webrtcActive.value) micStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (webrtcMixMicGain) webrtcMixMicGain.gain.value = muted ? 0 : inputVolume.value;
    if (webrtcActive.value) sendCmd("setMicrophoneMuted", { muted });
    if (muted && state.tsClientId) clearSpeaking(state.tsClientId);
    void saveAudioPreferences();
  }

  function clearError(): void {
    state.error = "";
    state.errorCode = "";
  }

  function protocolErrorMessage(code: string, fallback: string): string {
    const messages: Record<string, string> = {
      INVALID_JSON: "消息格式无效",
      INVALID_MESSAGE: "消息格式无效",
      INVALID_REQUEST_ID: "请求标识无效",
      UNKNOWN_MESSAGE_TYPE: "不支持的操作",
      INVALID_PAYLOAD: "操作参数无效",
      INVALID_CHANNEL_ID: "频道标识无效",
      INVALID_CHANNEL_PASSWORD: "频道密码无效",
      INVALID_CLIENT_ID: "成员标识无效",
      INVALID_TEXT_MESSAGE: "文字消息无效",
      INVALID_POKE_MESSAGE: "戳一戳消息无效",
      INVALID_AWAY_STATUS: "离开状态无效",
      INVALID_AUDIO_FRAME: "音频帧格式无效",
      INVALID_MEMBER_VOLUME: "成员音量无效",
      INVALID_WHISPER_TARGETS: "私语目标无效",
      INVALID_WHISPER_STATE: "私语状态无效",
      NO_WHISPER_TARGETS: "请先选择私语目标",
      SESSION_NOT_READY: "TeamSpeak 会话尚未就绪",
      CHANNEL_SWITCH_FAILED: "频道切换失败",
      CHANNEL_PASSWORD_REQUIRED: "该频道需要密码",
      CHANNEL_FULL: "该频道已满",
      PERMISSION_DENIED: "你没有执行此操作的权限",
      CLIENT_NOT_FOUND: "成员已离线",
      OPERATION_FAILED: "操作失败",
    };
    return messages[code] || fallback;
  }

  function setVolume(clientId: number, volume: number): void {
    const normalized = Math.max(0, Math.min(4, volume));
    volumes[clientId] = normalized;
    const member = members.find((candidate) => candidate.id === clientId);
    if (member?.uid) {
      storedVolumesByUid[member.uid] = normalized;
      void saveAudioPreferences();
    }
    const gain = remoteGains.get(clientId);
    if (gain) gain.gain.value = normalized * effectiveOutputVolume();
    if (webrtcPeer || webrtcActive.value) sendCmd("setMemberVolume", { clientId, volume: normalized });
  }

  function syncWebRtcMemberVolumes(): void {
    if (!webrtcActive.value || ws.value?.readyState !== WebSocket.OPEN) return;
    for (const [rawClientId, volume] of Object.entries(volumes)) {
      const clientId = Number(rawClientId);
      if (!Number.isInteger(clientId) || clientId <= 0) continue;
      sendCmd("setMemberVolume", { clientId, volume });
    }
  }

  function setInputVolume(volume: number): void {
    inputVolume.value = Math.max(0, Math.min(1, volume));
    if (micGain) micGain.gain.value = inputVolume.value;
    if (webrtcMixMicGain) webrtcMixMicGain.gain.value = microphoneMuted.value ? 0 : inputVolume.value;
    void saveAudioPreferences();
  }

  function setOutputVolume(volume: number): void {
    outputVolume.value = Math.max(0, Math.min(1, volume));
    applyOutputVolume();
    void saveAudioPreferences();
  }

  function toggleOutputMute(): void {
    outputMuted.value = !outputMuted.value;
    applyOutputVolume();
  }

  function setVoxThreshold(threshold: number): void {
    voxThreshold.value = clamp(threshold, 0.001, 0.08);
    void saveAudioPreferences();
  }

  function setNotificationVolume(volume: number): void {
    notificationVolume.value = clamp(volume, 0, 1);
    void saveAudioPreferences();
  }

  return {
    ws,
    state,
    members,
    channels,
    chatMessages,
    serverEvents,
    pokeNotifications,
    microphoneMuted,
    inputVolume,
    outputVolume,
    outputMuted,
    notificationVolume,
    voxThreshold,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    outputDeviceSupported,
    audioPermission,
    audioContextState,
    identityMaterial,
    micLevel,
    microphoneTestActive,
    testAudioUrl,
    speakingIds,
    whisperTargetIds,
    whisperActive,
    volumes,
    accompanimentActive,
    accompanimentSupported,
    accompanimentErrorCode,
    setVolume,
    setInputVolume,
    setOutputVolume,
    toggleOutputMute,
    setVoxThreshold,
    setNotificationVolume,
    prepareInputDevices,
    refreshAudioDevices,
    setInputDevice,
    setOutputDevice,
    startMicrophoneTest,
    stopMicrophoneTest,
    playNotification,
    connect,
    reconnectNow,
    disconnect,
    switchChannel,
    sendTextMessage,
    sendServerMessage,
    sendPrivateMessage,
    sendPoke,
    setAway,
    setWhisperTargets,
    setWhisperActive,
    setMicrophoneMuted,
    startAccompaniment,
    stopAccompaniment,
    checkSupport,
    clearError,
  };
}
