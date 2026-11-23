import { ref, push, set, update, serverTimestamp } from 'firebase/database';
import { database } from './firebase';
import { getNextReportNumber, formatReportId } from './reportUtils';
import { SCHOOL_CONFIG } from '@/config/school';

export interface PhoneBoothTurn {
  turn: number;
  speaker: 'student' | 'agent';
  text: string;
  emotion?: string;
  timestamp: number;
}

export interface ExtractedReportSlots {
  category?: string | null;
  severity_level?: 'L0' | 'L1' | 'L2' | 'L3' | null;
  location?: string | null;
  incident_timeframe?: string | null;
  implicated_person?: string | null;
  witnesses_present?: string | null;
  physical_harm_indicated?: boolean | null;
  is_ongoing?: boolean | null;
  immediate_danger?: boolean | null;
  is_escalation_required?: boolean | null;
  summary?: string;
}

export interface PhoneBoothState {
  isConnected: boolean;
  isCallActive: boolean;
  isAgentSpeaking: boolean;
  currentAgentSentence?: string;
  lastTranscribedStudentSpeech?: string;
  shouldAutoHangup?: boolean;
  isStudentListening: boolean;
  currentEmotion: string;
  categoryGuess: string;
  inquiryState: string;
  turns: PhoneBoothTurn[];
  extractedSlots: ExtractedReportSlots;
  serverUrl: string;
  conversationId: string | null;
  reportId: string | null;
  error: string | null;
}

export const SECONDARY_LAPTOP_WS_URL = 'ws://192.168.10.39:8765';
export const MDNS_LAPTOP_WS_URL = 'ws://desktop-4l1f9jg.local:8765';
const DEFAULT_WS_URL = SECONDARY_LAPTOP_WS_URL;
const STORAGE_KEY_WS = 'safespeak_phone_booth_ws';

// ElevenLabs Ultra-Realistic Spoken Voice Engine with Multi-Key Rotation
export const ELEVEN_LABS_KEYS = [
  'sk_8fde097b04c48a06ce5631baed05ea4dc4b9ea69df463597',
  'sk_ca770c72b95cb453420917026a970f32dd2ff2fc57c1b551',
  'sk_0a20833dd98773b18282f07fb2da25ea1ef68e68b1b43e6e',
  'sk_f017c44fdd87a3f70b6c1b4e18bca9634185b96b8964063a'
];
export const ELEVEN_LABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah (Mature, Reassuring, Confident - Premade Free Tier)

export function getSavedPhoneBoothWsUrl(): string {
  if (typeof window === 'undefined') return SECONDARY_LAPTOP_WS_URL;
  try {
    const rawSearch = window.location.search || (window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    const urlParams = new URLSearchParams(rawSearch);
    const paramWs = urlParams.get('ws');
    if (paramWs) {
      savePhoneBoothWsUrl(paramWs);
      return paramWs;
    }
    const saved = localStorage.getItem(STORAGE_KEY_WS);
    if (saved && saved !== 'ws://127.0.0.1:8765' && saved !== 'ws://localhost:8765') {
      return saved;
    }
    return SECONDARY_LAPTOP_WS_URL;
  } catch {
    return SECONDARY_LAPTOP_WS_URL;
  }
}

export function savePhoneBoothWsUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    let clean = url.trim();
    if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) {
      clean = `ws://${clean}`;
    }
    localStorage.setItem(STORAGE_KEY_WS, clean);
  } catch (e) {
    console.error('Failed to save Phone Booth WS URL:', e);
  }
}

export interface SpeechQueueItem {
  text: string;
  audioBase64?: string | null;
}

export class PhoneBoothSessionManager {
  private ws: WebSocket | null = null;
  private currentConversationKey: string | null = null;
  private currentReportKey: string | null = null;
  private currentReportNumber: number = 0;
  private turnCounter: number = 0;
  private startTime: number = 0;
  private listeners: ((state: Partial<PhoneBoothState>) => void)[] = [];
  private turns: PhoneBoothTurn[] = [];
  
  // Phase 3 Streaming Audio Queue & Barge-In State
  private speechQueue: SpeechQueueItem[] = [];
  private isProcessingQueue: boolean = false;
  private currentAgentBubbleText: string = "";
  private currentAudio: HTMLAudioElement | null = null;
  private currentKeyIndex: number = 0;
  private pendingHangup: boolean = false;

  public subscribe(fn: (state: Partial<PhoneBoothState>) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify(change: Partial<PhoneBoothState>) {
    this.listeners.forEach(fn => fn(change));
  }

  private onSpeechFinished() {
    this.notify({ isAgentSpeaking: false, currentAgentSentence: '' });
    if (this.pendingHangup) {
      this.pendingHangup = false;
      console.log('👋 [TTS Finished] Auto-hangup closing words completed. Triggering hangup.');
      this.notify({ shouldAutoHangup: true });
    }
  }

  /**
   * Fetches high-quality human speech from ElevenLabs with multi-key rotation
   */
  private async fetchElevenLabsAudio(text: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    const maxAttempts = ELEVEN_LABS_KEYS.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const apiKey = ELEVEN_LABS_KEYS[this.currentKeyIndex];
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_LABS_VOICE_ID}/stream?optimize_streaming_latency=4`, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey
          },
          body: JSON.stringify({
            text: text,
            model_id: 'eleven_turbo_v2_5', // Fastest model for conversational AI (<250ms)
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              style: 0.0,
              use_speaker_boost: true
            }
          })
        });

        if (response.ok) {
          const blob = await response.blob();
          return URL.createObjectURL(blob);
        } else {
          console.warn(`ElevenLabs key #${this.currentKeyIndex + 1} status: ${response.status}. Rotating key...`);
          this.currentKeyIndex = (this.currentKeyIndex + 1) % ELEVEN_LABS_KEYS.length;
        }
      } catch (err) {
        console.warn(`ElevenLabs key #${this.currentKeyIndex + 1} network error:`, err);
        this.currentKeyIndex = (this.currentKeyIndex + 1) % ELEVEN_LABS_KEYS.length;
      }
    }
    return null;
  }

  /**
   * Phase 3 Streaming TTS Queue
   * Prioritizes ElevenLabs ultra-realistic human voice; falls back to browser TTS if offline.
   */
  private async processSpeechQueue() {
    if (this.isProcessingQueue || this.speechQueue.length === 0) return;
    this.isProcessingQueue = true;
    const item = this.speechQueue.shift()!;
    const textToSpeak = item.text;

    this.notify({ isAgentSpeaking: true, currentAgentSentence: textToSpeak });

    // 1. If server streamed pre-synthesized ElevenLabs HD Audio:
    if (item.audioBase64) {
      try {
        const audio = new Audio('data:audio/mpeg;base64,' + item.audioBase64);
        this.currentAudio = audio;

        audio.onended = () => {
          this.currentAudio = null;
          this.isProcessingQueue = false;
          if (this.speechQueue.length > 0) {
            this.processSpeechQueue();
          } else {
            this.onSpeechFinished();
          }
        };

        audio.onerror = () => {
          this.currentAudio = null;
          this.isProcessingQueue = false;
          this.playBrowserTTSFallback(textToSpeak);
        };

        await audio.play();
        return;
      } catch (e) {
        console.warn('Direct ElevenLabs audio playback error, falling back:', e);
      }
    }

    // 2. Client-side fetch from ElevenLabs with working Sarah premade voice
    try {
      const audioUrl = await this.fetchElevenLabsAudio(textToSpeak);
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          this.isProcessingQueue = false;
          if (this.speechQueue.length > 0) {
            this.processSpeechQueue();
          } else {
            this.onSpeechFinished();
          }
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          this.isProcessingQueue = false;
          this.playBrowserTTSFallback(textToSpeak);
        };

        await audio.play();
        return;
      }
    } catch (e) {
      console.warn('ElevenLabs playback error, using fallback:', e);
    }

    // 3. Failure-Safe Fallback to Browser SpeechSynthesis
    this.playBrowserTTSFallback(textToSpeak);
  }

  private playBrowserTTSFallback(textToSpeak: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.isProcessingQueue = false;
      this.onSpeechFinished();
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      utterance.lang = 'en-US';

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => 
        (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Karen')) 
        && v.lang.startsWith('en')
      );
      if (preferred) utterance.voice = preferred;

      utterance.onend = () => {
        this.isProcessingQueue = false;
        if (this.speechQueue.length > 0) {
          this.processSpeechQueue();
        } else {
          this.onSpeechFinished();
        }
      };

      utterance.onerror = () => {
        this.isProcessingQueue = false;
        if (this.speechQueue.length > 0) {
          this.processSpeechQueue();
        } else {
          this.onSpeechFinished();
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      this.isProcessingQueue = false;
      this.onSpeechFinished();
    }
  }

  /**
   * Immediately halts all speech synthesis (Barge-In Interruption)
   */
  public stopSpeaking() {
    this.speechQueue = [];
    this.isProcessingQueue = false;
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.notify({ isAgentSpeaking: false, currentAgentSentence: '' });
  }

  /**
   * Probes the server URL without starting a call session to check if AI is online
   */
  public async probeConnection(serverUrl: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      try {
        let clean = serverUrl.trim();
        if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) {
          clean = `ws://${clean}`;
        }
        const testWs = new WebSocket(clean);
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try { testWs.close(); } catch {}
            this.notify({ isConnected: false });
            resolve({ success: false, error: 'Connection timed out (3s). Check IP address and Windows Firewall.' });
          }
        }, 3000);

        testWs.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            const latency = Date.now() - startTime;
            try { testWs.close(); } catch {}
            this.notify({ isConnected: true });
            resolve({ success: true, latencyMs: latency });
          }
        };

        testWs.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.notify({ isConnected: false });
            resolve({ success: false, error: 'Connection refused. Ensure START-AI-SERVER.bat is running on the laptop and port 8765 is allowed in Firewall.' });
          }
        };
      } catch (err: any) {
        this.notify({ isConnected: false });
        resolve({ success: false, error: err?.message || 'Invalid WebSocket URL' });
      }
    });
  }

  /**
   * Auto-probes candidate URLs in parallel and returns the first responding server address
   */
  public async findActiveServerUrl(preferredUrl?: string): Promise<string> {
    const candidates = Array.from(new Set([
      preferredUrl,
      getSavedPhoneBoothWsUrl(),
      'ws://127.0.0.1:8765',
      'ws://localhost:8765',
      'ws://desktop-4l1f9jg.local:8765',
      'ws://192.168.10.39:8765',
      'ws://192.168.10.44:8765'
    ].filter(Boolean) as string[]));

    return new Promise((resolve) => {
      let resolved = false;
      let failedCount = 0;

      const tryCandidate = (url: string) => {
        try {
          let clean = url.trim();
          if (!clean.startsWith('ws://') && !clean.startsWith('wss://')) clean = `ws://${clean}`;
          const socket = new WebSocket(clean);
          const t = setTimeout(() => {
            try { socket.close(); } catch {}
            onFail();
          }, 1500);

          socket.onopen = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(t);
              try { socket.close(); } catch {}
              console.log(`🎯 Auto-discovered active SafeSpeak AI server at: ${clean}`);
              savePhoneBoothWsUrl(clean);
              resolve(clean);
            }
          };

          socket.onerror = () => {
            clearTimeout(t);
            onFail();
          };
        } catch {
          onFail();
        }
      };

      const onFail = () => {
        failedCount++;
        if (failedCount >= candidates.length && !resolved) {
          resolved = true;
          resolve(candidates[0] || 'ws://192.168.10.39:8765');
        }
      };

      candidates.forEach(tryCandidate);
    });
  }

  /**
   * Starts a Phone Booth call session:
   * 1. Creates a real-time conversation record in Firebase
   * 2. Auto-discovers and connects WebSocket to secondary laptop AI
   * 3. Sends call_started event
   */
  public async startCall(serverUrl: string = getSavedPhoneBoothWsUrl()): Promise<boolean> {
    this.startTime = Date.now();
    this.turnCounter = 0;
    this.turns = [];
    this.speechQueue = [];
    this.isProcessingQueue = false;
    this.currentAgentBubbleText = "";

    // 1. Initialize Firebase Conversation entry immediately
    try {
      this.currentReportNumber = await getNextReportNumber();
      const reportIdStr = formatReportId(this.currentReportNumber);
      
      const convRef = push(ref(database, 'conversations'));
      this.currentConversationKey = convRef.key;

      if (this.currentConversationKey) {
        await set(convRef, {
          conversationId: this.currentConversationKey,
          reportId: reportIdStr,
          school: SCHOOL_CONFIG.name,
          startedAt: serverTimestamp(),
          status: 'in_progress',
          stationId: 'booth-main',
          transcript: [],
          extractedSlots: {},
          emotionalArc: []
        });
      }

      this.notify({
        isCallActive: true,
        conversationId: this.currentConversationKey,
        reportId: reportIdStr,
        turns: [],
        currentEmotion: 'Connecting...',
        error: null
      });
    } catch (fbErr) {
      console.warn('Firebase conversation init error (will continue locally):', fbErr);
    }

    // 2. Discover active server and connect
    const targetWsUrl = await this.findActiveServerUrl(serverUrl);

    return new Promise((resolve) => {
      try {
        console.log(`Connecting to SafeSpeak AI Voice Server: ${targetWsUrl}`);
        this.ws = new WebSocket(targetWsUrl);

        this.ws.onopen = () => {
          console.log(`✅ WebSocket connection established with AI Voice Engine at ${targetWsUrl}`);
          this.notify({ isConnected: true, error: null });
          resolve(true);
        };

        this.ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            await this.handleIncomingMessage(data);
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          this.notify({
            isConnected: false,
            error: `Could not connect to AI Server at ${serverUrl}. Ensure the secondary laptop is running start-phone-booth-server.`
          });
          resolve(false);
        };

        this.ws.onclose = () => {
          console.log('WebSocket closed');
          this.notify({ isConnected: false });
        };
      } catch (e: any) {
        this.notify({ isConnected: false, error: e?.message || 'WebSocket connection failed' });
        resolve(false);
      }
    });
  }

  /**
   * Phase 3 Streaming Message Handler
   */
  private async handleIncomingMessage(data: any) {
    // 0. Transcribed student speech from server-side ElevenLabs Scribe STT
    if (data.type === 'student_speech_transcribed') {
      const studentText = (data.text || '').trim();
      if (studentText) {
        console.log('🎙️ [Server STT Transcribed]:', studentText);
        // Avoid duplicate student turn if already recorded recently
        const lastTurn = this.turns.length > 0 ? this.turns[this.turns.length - 1] : null;
        if (!lastTurn || lastTurn.speaker !== 'student' || lastTurn.text.toLowerCase() !== studentText.toLowerCase()) {
          this.turnCounter += 1;
          const turnObj: PhoneBoothTurn = {
            turn: this.turnCounter,
            speaker: 'student',
            text: studentText,
            timestamp: Date.now()
          };
          this.turns.push(turnObj);
        }

        if (this.currentConversationKey) {
          try {
            const turnRef = push(ref(database, `conversations/${this.currentConversationKey}/transcript`));
            await set(turnRef, {
              turn: this.turnCounter,
              speaker: 'student',
              text: studentText,
              timestamp: Date.now()
            });
          } catch (e) {
            console.warn('Firebase student STT turn sync error:', e);
          }
        }

        this.notify({
          turns: [...this.turns],
          lastTranscribedStudentSpeech: studentText
        });
      }
      return;
    }

    // 1. Streaming Sentence Token Delivery (<500ms time-to-speech)
    if (data.type === 'agent_stream_sentence') {
      const sentence = data.sentence || '';
      const emotion = data.detected_emotion || 'Listening';
      const audioBase64 = data.audio_base64 || null;

      // Enqueue sentence for immediate speech playback
      this.speechQueue.push({ text: sentence, audioBase64 });
      this.processSpeechQueue();

      this.currentAgentBubbleText = (this.currentAgentBubbleText + ' ' + sentence).trim();

      if (this.turns.length > 0 && this.turns[this.turns.length - 1].speaker === 'agent') {
        this.turns[this.turns.length - 1].text = this.currentAgentBubbleText;
        this.turns[this.turns.length - 1].emotion = emotion;
      } else {
        this.turnCounter += 1;
        const turnObj: PhoneBoothTurn = {
          turn: this.turnCounter,
          speaker: 'agent',
          text: sentence,
          emotion: emotion,
          timestamp: Date.now()
        };
        this.turns.push(turnObj);
      }

      // Sync to Firebase live transcript
      if (this.currentConversationKey) {
        try {
          const turnRef = push(ref(database, `conversations/${this.currentConversationKey}/transcript`));
          await set(turnRef, {
            turn: this.turnCounter,
            speaker: 'agent',
            text: sentence,
            emotion: emotion,
            timestamp: Date.now()
          });
        } catch (e) {
          console.warn('Firebase turn sync error:', e);
        }
      }

      this.notify({
        turns: [...this.turns],
        currentEmotion: emotion,
        currentAgentSentence: sentence
      });
    }

    // 2. Background Extracted Slots Update
    if (data.type === 'turn_slots_updated') {
      const slots = data.slots || {};
      const emotion = data.detected_emotion || 'Empathetic';
      const category = data.category || 'other';

      if (this.currentConversationKey) {
        try {
          await update(ref(database, `conversations/${this.currentConversationKey}`), {
            currentEmotion: emotion,
            categoryGuess: category,
            lastUpdated: serverTimestamp(),
            extractedSlots: slots
          });
        } catch (e) {}
      }

      this.notify({
        currentEmotion: emotion,
        categoryGuess: category,
        extractedSlots: slots
      });
    }

    // 3. Voice-Activated Goodbye / Auto-Hangup Signal
    if (data.type === 'agent_goodbye_conclusion') {
      this.notify({ shouldAutoHangup: true });
    }
  }

  /**
   * Transmit raw audio base64 (16kHz 16-bit Mono WAV from VAD) to secondary laptop for ElevenLabs Scribe STT
   */
  public async sendStudentAudio(audioBase64: string) {
    if (!audioBase64) return;

    // Barge-In: if AI is currently speaking, cut off speech immediately so student is heard!
    if (this.currentAudio || this.speechQueue.length > 0 || (typeof window !== 'undefined' && window.speechSynthesis.speaking)) {
      this.stopSpeaking();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'barge_in' }));
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('📡 [Sending Student Audio] Transmitting WAV buffer to AI server for Scribe STT...');
      this.ws.send(JSON.stringify({
        type: 'student_audio',
        audio_base64: audioBase64
      }));
    } else {
      console.warn('⚠️ WebSocket not open for student_audio transmission.');
    }
  }

  /**
   * Send student speech turn with automatic Barge-In (interruption) handling
   */
  public async sendStudentSpeech(text: string) {
    if (!text || text.trim().length === 0) return;

    // Barge-In: if AI is currently speaking, cut off speech immediately so student is heard!
    if (this.currentAudio || this.speechQueue.length > 0 || (typeof window !== 'undefined' && window.speechSynthesis.speaking)) {
      this.stopSpeaking();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'barge_in' }));
      }
    }

    this.currentAgentBubbleText = ""; // Reset agent bubble for the next turn
    this.turnCounter += 1;
    const turnObj: PhoneBoothTurn = {
      turn: this.turnCounter,
      speaker: 'student',
      text: text.trim(),
      timestamp: Date.now()
    };
    this.turns.push(turnObj);
    this.notify({
      turns: [...this.turns]
    });

    // 1. Sync student turn immediately to Firebase
    if (this.currentConversationKey) {
      try {
        const turnRef = push(ref(database, `conversations/${this.currentConversationKey}/transcript`));
        await set(turnRef, turnObj);
      } catch (e) {
        console.warn('Firebase student turn sync error:', e);
      }
    }

    // 2. Transmit to secondary laptop AI over WebSocket or run client-side offline conversational AI
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'student_speech',
        text: text.trim()
      }));
    } else {
      console.warn('WebSocket not open. Running intelligent local conversational fallback with ElevenLabs HD Voice...');
      try {
        const { analyzeReportDemo, getSupportiveMessageAndFeelings } = await import('./safeSpeakAI');
        const localAnalysis = await analyzeReportDemo(text.trim());
        const isEscalate = localAnalysis.risk_level === 'L3';

        const offlineSlots: ExtractedReportSlots = {
          category: localAnalysis.category,
          severity_level: localAnalysis.risk_level,
          summary: text.trim(),
          is_escalation_required: isEscalate
        };

        this.notify({
          categoryGuess: localAnalysis.category,
          currentEmotion: localAnalysis.sentiment || 'Heard',
          extractedSlots: offlineSlots
        });

        // Check if student said goodbye
        const isGoodbye = /\b(goodbye|good bye|bye|bye bye|that's all|thats all|i'm done|im done|thank you bye|hang up|end call|that is all|nothing else|see you|got to go|have to go|done now|finish)\b/i.test(text);

        let aiReply = "";
        if (isGoodbye) {
          aiReply = "Thank you for sharing this with me. Your report has been safely noted for our counselors, and you did wonderfully by speaking up today. Take care, and goodbye!";
        } else {
          const supp = getSupportiveMessageAndFeelings(localAnalysis.category, localAnalysis.risk_level);
          aiReply = supp.message ? `${supp.message} Take your time—is there anything else you would like to share?` : "I hear you, and thank you for trusting me with that. What you are experiencing matters, and I am listening. Is there anything else you'd like to share?";
        }

        // Add AI turn to history
        this.turnCounter += 1;
        const aiTurn: PhoneBoothTurn = {
          turn: this.turnCounter,
          speaker: 'agent',
          text: aiReply,
          emotion: localAnalysis.sentiment || 'Empathetic',
          timestamp: Date.now()
        };
        this.turns.push(aiTurn);
        this.notify({
          turns: [...this.turns],
          currentEmotion: localAnalysis.sentiment || 'Empathetic'
        });

        // Enqueue and speak via ElevenLabs HD Voice
        this.speechQueue.push({ text: aiReply });
        this.processSpeechQueue();

        if (isGoodbye) {
          this.pendingHangup = true;
        }
      } catch (e) {
        console.warn('Offline conversational fallback error:', e);
      }
    }
  }

  /**
   * Ends call, finalizes transcript in Firebase, and writes the complete structured report
   */
  public async endCall(currentSlots: ExtractedReportSlots): Promise<{ reportId: string | null; key: string | null }> {
    this.stopSpeaking();

    // 1. Notify WebSocket server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'call_ended' }));
        this.ws.close();
      } catch {}
    }

    const durationSeconds = Math.round((Date.now() - this.startTime) / 1000);
    const reportIdStr = formatReportId(this.currentReportNumber);

    let savedReportKey: string | null = null;

    // 2. Finalize Conversation record in Firebase
    if (this.currentConversationKey) {
      try {
        await update(ref(database, `conversations/${this.currentConversationKey}`), {
          status: 'completed',
          endedAt: serverTimestamp(),
          durationSeconds: durationSeconds,
          finalSlots: currentSlots
        });
      } catch (e) {
        console.error('Error finalizing conversation in Firebase:', e);
      }
    }

    // 3. Write Synthesized Report to Firebase
    try {
      const rawEscalation = (currentSlots as any).escalation_decision || {};
      const aiRequestedHigherAuth = rawEscalation.reporting_pathway === 'higher_authority';
      const isTeacher = currentSlots.category === 'teacher_involved' || (currentSlots.implicated_person && /teacher|staff|principal|coach|sir|madam|miss/i.test(currentSlots.implicated_person));
      const isL3 = currentSlots.severity_level === 'L3' || currentSlots.is_escalation_required;
      const requiresHigherAuthority = aiRequestedHigherAuth || isTeacher || isL3;

      const categoryVal = currentSlots.category || (isTeacher ? 'teacher_involved' : 'safety');
      const intensityVal = isL3 || currentSlots.immediate_danger ? 'extreme' : currentSlots.severity_level === 'L2' ? 'high' : 'medium';

      const rawIdentity = (currentSlots as any).identity || {};
      const rawIncident = (currentSlots as any).incident || {};
      const rawPrefs = (currentSlots as any).child_preferences || {};
      const rawSupport = (currentSlots as any).support_needs || {};
      const rawSafety = (currentSlots as any).safety_flags || {};
      const rawQuality = (currentSlots as any).report_quality || {};
      const rawEvidence = (currentSlots as any).evidence_layer || {};

      const childName = rawIdentity.name || currentSlots.implicated_person || null;
      const isAnonPref = rawIdentity.anonymous_preference === 'anonymous' || rawPrefs.wants_anonymity === true;

      const reportPayload = {
        // Structured Report Schema
        report_id: reportIdStr,
        reportId: reportIdStr,
        reportNumber: this.currentReportNumber,
        report_status: requiresHigherAuthority ? 'escalated' : 'pending_review',
        status: requiresHigherAuthority ? 'escalated' : 'received',
        isEscalated: requiresHigherAuthority,
        created_at: serverTimestamp(),
        timestamp: serverTimestamp(),
        durationSeconds: durationSeconds,
        source: 'phone_booth_voice_agent',
        school: SCHOOL_CONFIG.name,
        conversationId: this.currentConversationKey,

        // 1. Identity & Anonymity
        identity: {
          name: childName,
          name_provided: Boolean(rawIdentity.name_provided || childName),
          anonymous_preference: rawIdentity.anonymous_preference || (isAnonPref ? 'anonymous' : 'undecided'),
          identity_confirmation: rawIdentity.identity_confirmation || 'not_confirmed'
        },

        // 2. Incident Details
        incident: {
          category: rawIncident.category || categoryVal,
          description: rawIncident.description || currentSlots.summary || `Phone booth voice report (${durationSeconds}s call)`,
          frequency: rawIncident.frequency || (currentSlots.is_ongoing ? 'repeated' : 'unknown'),
          location: rawIncident.location || currentSlots.location || null,
          time_context: rawIncident.time_context || currentSlots.incident_timeframe || null
        },

        // 3. Child Preferences
        child_preferences: {
          wants_anonymity: rawPrefs.wants_anonymity !== undefined ? rawPrefs.wants_anonymity : (isAnonPref ? true : null),
          wants_to_continue: rawPrefs.wants_to_continue !== undefined ? rawPrefs.wants_to_continue : true,
          preferred_support_person: rawPrefs.preferred_support_person || null
        },

        // 4. Support Needs
        support_needs: {
          requested_help: rawSupport.requested_help || null,
          concerns: rawSupport.concerns || []
        },

        // 5. Safety Flags
        safety_flags: {
          urgent_review: isL3 || rawSafety.urgent_review || false,
          human_review_required: true
        },

        // 6. AI Escalation Pathway
        escalation_decision: {
          reporting_pathway: requiresHigherAuthority ? 'higher_authority' : 'normal',
          reason: rawEscalation.reason || (isTeacher ? 'Teacher or school staff implicated' : isL3 ? 'Critical severity L3 safety risk' : 'Standard peer report')
        },

        // 7. Report Quality & Evidence Layer
        report_quality: {
          missing_fields: rawQuality.missing_fields || [],
          ai_confidence: rawQuality.ai_confidence || 'direct_statements'
        },
        evidence_layer: {
          name_evidence: rawEvidence.name_evidence || (childName ? 'direct' : 'unknown'),
          frequency_evidence: rawEvidence.frequency_evidence || 'unknown',
          location_evidence: rawEvidence.location_evidence || (currentSlots.location ? 'direct' : 'unknown')
        },

        // 8. Human Review Tracking
        review: {
          reviewer_id: null,
          reviewed_at: null,
          outcome: null
        },

        // Legacy compatibility fields
        category: categoryVal,
        intensity: intensityVal,
        severityLevel: currentSlots.severity_level || (isL3 ? 'L3' : 'L1'),
        riskLevel: requiresHigherAuthority ? 'High' : 'Normal',
        description: currentSlots.summary || `Phone booth voice report (${durationSeconds}s call)`,
        location: currentSlots.location || SCHOOL_CONFIG.name,
        incidentTimeframe: currentSlots.incident_timeframe || null,
        witnessesPresent: currentSlots.witnesses_present || null,
        physicalHarmIndicated: currentSlots.physical_harm_indicated || false,
        isAnonymous: isAnonPref,
        implicatedName: currentSlots.implicated_person || null,
        personType: isTeacher ? 'teacher' : 'student',
        extractedSlots: currentSlots,
        ...(requiresHigherAuthority ? {
          escalationMeta: {
            escalated_by: 'ai_phone_booth_evaluation',
            escalated_reason: rawEscalation.reason || (isTeacher ? 'Teacher or staff member implicated' : 'Critical urgency'),
            pathway: 'higher_authority',
            timestamp: serverTimestamp()
          }
        } : {})
      };

      // Push to standard reports or higher authority based on AI escalation decision
      const targetNode = requiresHigherAuthority ? 'higher_authority_reports' : 'reports';
      const pushed = await push(ref(database, targetNode), reportPayload);
      savedReportKey = pushed.key;

      console.log(`✅ Phone Booth report stored to Firebase at ${targetNode}/${savedReportKey} (${requiresHigherAuthority ? 'Higher Authority' : 'Normal'})`);
    } catch (repErr) {
      console.error('Failed to save synthesized report to Firebase:', repErr);
    }

    this.notify({
      isCallActive: false,
      isConnected: false,
      currentEmotion: 'Call Finished'
    });

    return { reportId: reportIdStr, key: savedReportKey };
  }
}

export const phoneBoothManager = new PhoneBoothSessionManager();
