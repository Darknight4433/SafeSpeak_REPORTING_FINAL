/**
 * SafeSpeak Audio Voice Detector (VAD) & Real-Time WAV Audio Streamer
 * 
 * Capabilities:
 * 1. Live microphone RMS volume detection (0% - 100%) for live UI audio visualizers.
 * 2. Voice Activity Detection (VAD) for 100% hands-free phone booth operation:
 *    - Auto-wakes the station when student starts speaking.
 *    - Instant barge-in: interrupts AI voice immediately when student starts talking.
 * 3. In-memory 16kHz 16-bit Mono PCM WAV encoder:
 *    - Encodes raw audio without external dependencies.
 *    - Streams base64 WAV buffers directly to ElevenLabs Scribe STT for crystal-clear STT on Linux/Raspberry Pi.
 */

export interface VoiceDetectorOptions {
  sampleRate?: number;
  vadThreshold?: number; // 0.0 to 1.0 (typical 0.025 to 0.05)
  silenceDebounceMs?: number; // Silence duration before sending turn (e.g. 900ms)
  minSpeechDurationMs?: number; // Minimum speech length to consider valid (e.g. 400ms)
  onVolumeChange?: (volumePercent: number, isSpeaking: boolean) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (wavBase64: string) => void;
  onError?: (err: Error) => void;
}

export class AudioVoiceDetector {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private isRunning: boolean = false;
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private silenceTimer: number | null = null;
  private recordedChunks: Float32Array[] = [];
  private totalRecordedSamples: number = 0;

  private sampleRate: number;
  private vadThreshold: number;
  private silenceDebounceMs: number;
  private minSpeechDurationMs: number;

  private onVolumeChange?: (volumePercent: number, isSpeaking: boolean) => void;
  private onSpeechStart?: () => void;
  private onSpeechEnd?: (wavBase64: string) => void;
  private onError?: (err: Error) => void;

  constructor(options: VoiceDetectorOptions = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.vadThreshold = options.vadThreshold !== undefined ? options.vadThreshold : 0.035;
    this.silenceDebounceMs = options.silenceDebounceMs || 1000;
    this.minSpeechDurationMs = options.minSpeechDurationMs || 400;

    this.onVolumeChange = options.onVolumeChange;
    this.onSpeechStart = options.onSpeechStart;
    this.onSpeechEnd = options.onSpeechEnd;
    this.onError = options.onError;
  }

  public async start(): Promise<boolean> {
    if (this.isRunning) return true;

    try {
      if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia is not supported on this device/browser');
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;

      // 4096 buffer size gives ~250ms chunks at 16kHz
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isRunning) return;
        const inputData = e.inputBuffer.getChannelData(0);
        this.processAudioFrame(inputData);
      };

      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.processorNode);
      // ScriptProcessor requires connecting to destination to receive events in Chrome/Firefox
      this.processorNode.connect(this.audioContext.destination);

      this.isRunning = true;
      return true;
    } catch (err: any) {
      console.warn('AudioVoiceDetector start error:', err);
      if (this.onError) this.onError(err);
      this.stop();
      return false;
    }
  }

  private processAudioFrame(samples: Float32Array) {
    // 1. Calculate RMS Volume
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    // Scale RMS nicely to 0-100%
    const volumePercent = Math.min(100, Math.round(rms * 350));

    const isAboveThreshold = rms > this.vadThreshold;

    if (this.onVolumeChange) {
      this.onVolumeChange(volumePercent, this.isSpeaking);
    }

    const now = Date.now();

    // 2. Voice Activity Detection State Machine
    if (isAboveThreshold) {
      if (this.silenceTimer !== null) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechStartTime = now;
        this.recordedChunks = [];
        this.totalRecordedSamples = 0;
        if (this.onSpeechStart) {
          this.onSpeechStart();
        }
      }

      // Clone buffer and accumulate
      const chunk = new Float32Array(samples);
      this.recordedChunks.push(chunk);
      this.totalRecordedSamples += chunk.length;

      // Auto-dispatch safety limit: 15 seconds continuous speech
      if (now - this.speechStartTime > 15000) {
        this.finalizeSpeechTurn();
      }
    } else {
      if (this.isSpeaking) {
        // Collect tail end of audio (to avoid cutting off the last syllable)
        const chunk = new Float32Array(samples);
        this.recordedChunks.push(chunk);
        this.totalRecordedSamples += chunk.length;

        if (this.silenceTimer === null) {
          this.silenceTimer = window.setTimeout(() => {
            this.finalizeSpeechTurn();
          }, this.silenceDebounceMs);
        }
      }
    }
  }

  private finalizeSpeechTurn() {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (!this.isSpeaking) return;
    this.isSpeaking = false;

    const speechDuration = Date.now() - this.speechStartTime;
    if (speechDuration < this.minSpeechDurationMs || this.totalRecordedSamples === 0) {
      this.recordedChunks = [];
      this.totalRecordedSamples = 0;
      return;
    }

    // Merge Float32 chunks
    const merged = new Float32Array(this.totalRecordedSamples);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.recordedChunks = [];
    this.totalRecordedSamples = 0;

    // Encode to 16kHz 16-bit Mono WAV
    const wavBase64 = this.encodeWAV(merged, this.sampleRate);
    if (this.onSpeechEnd && wavBase64) {
      this.onSpeechEnd(wavBase64);
    }
  }

  /**
   * Pure JS WAV (RIFF/WAVE 16-bit PCM Mono) Encoder
   * Converts Float32 audio samples into a standard base64 WAV file
   */
  private encodeWAV(samples: Float32Array, sampleRate: number): string {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // Helper to write ASCII strings
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');

    // fmt sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true); // NumChannels (1 = Mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // BitsPerSample (16 bits)

    // data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write PCM 16-bit samples with clipping
    let pcmOffset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(pcmOffset, Math.round(val), true);
      pcmOffset += 2;
    }

    // Convert ArrayBuffer to binary string then Base64
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  public stop() {
    this.isRunning = false;
    this.isSpeaking = false;

    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    try {
      if (this.processorNode) {
        this.processorNode.disconnect();
        this.processorNode = null;
      }
      if (this.analyserNode) {
        this.analyserNode.disconnect();
        this.analyserNode = null;
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close();
        this.audioContext = null;
      }
    } catch (e) {
      console.warn('Error stopping AudioVoiceDetector:', e);
    }
  }
}
