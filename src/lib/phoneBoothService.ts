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
  location?: string | null;
  implicated_person?: string | null;
  witnesses?: string | null;
  is_ongoing?: boolean | null;
  immediate_danger?: boolean | null;
  summary?: string;
}

export interface PhoneBoothState {
  isConnected: boolean;
  isCallActive: boolean;
  isAgentSpeaking: boolean;
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

const DEFAULT_WS_URL = 'ws://127.0.0.1:8765';
const STORAGE_KEY_WS = 'safespeak_phone_booth_ws';

export function getSavedPhoneBoothWsUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_WS_URL;
  try {
    return localStorage.getItem(STORAGE_KEY_WS) || DEFAULT_WS_URL;
  } catch {
    return DEFAULT_WS_URL;
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

export class PhoneBoothSessionManager {
  private ws: WebSocket | null = null;
  private currentConversationKey: string | null = null;
  private currentReportKey: string | null = null;
  private currentReportNumber: number = 0;
  private turnCounter: number = 0;
  private startTime: number = 0;
  private listeners: ((state: Partial<PhoneBoothState>) => void)[] = [];
  
  // Phase 3 Streaming Audio Queue & Barge-In State
  private speechQueue: string[] = [];
  private isProcessingQueue: boolean = false;
  private currentAgentBubbleText: string = "";

  public subscribe(fn: (state: Partial<PhoneBoothState>) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify(change: Partial<PhoneBoothState>) {
    this.listeners.forEach(fn => fn(change));
  }

  /**
   * Phase 3 Streaming TTS Queue
   * Plays sentences in FIFO order as soon as they are streamed from the server.
   */
  private processSpeechQueue() {
    if (this.isProcessingQueue || this.speechQueue.length === 0) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    this.isProcessingQueue = true;
    const textToSpeak = this.speechQueue.shift()!;

    try {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 0.95; // Gentle, understandable rate for students
      utterance.pitch = 1.05; // Warm, supportive pitch
      utterance.lang = 'en-US';

      // Pick natural or child-friendly voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => 
        (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Karen')) 
        && v.lang.startsWith('en')
      );
      if (preferred) utterance.voice = preferred;

      this.notify({ isAgentSpeaking: true });

      utterance.onend = () => {
        this.isProcessingQueue = false;
        if (this.speechQueue.length > 0) {
          this.processSpeechQueue();
        } else {
          this.notify({ isAgentSpeaking: false });
        }
      };

      utterance.onerror = () => {
        this.isProcessingQueue = false;
        if (this.speechQueue.length > 0) {
          this.processSpeechQueue();
        } else {
          this.notify({ isAgentSpeaking: false });
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('TTS playback error:', e);
      this.isProcessingQueue = false;
      this.notify({ isAgentSpeaking: false });
    }
  }

  /**
   * Immediately halts all speech synthesis (Barge-In)
   */
  public stopSpeaking() {
    this.speechQueue = [];
    this.isProcessingQueue = false;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.notify({ isAgentSpeaking: false });
    }
  }

  /**
   * Starts a Phone Booth call session:
   * 1. Creates a real-time conversation record in Firebase
   * 2. Opens WebSocket connection to secondary laptop AI
   * 3. Sends call_started event
   */
  public async startCall(serverUrl: string = getSavedPhoneBoothWsUrl()): Promise<boolean> {
    this.startTime = Date.now();
    this.turnCounter = 0;
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

    // 2. Connect WebSocket to Secondary Laptop
    return new Promise((resolve) => {
      try {
        console.log(`Connecting to SafeSpeak AI Voice Server: ${serverUrl}`);
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connection established with AI Voice Engine');
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
    // 1. Streaming Sentence Token Delivery (<500ms time-to-speech)
    if (data.type === 'agent_stream_sentence') {
      const sentence = data.sentence || '';
      const emotion = data.detected_emotion || 'Listening';

      // Enqueue sentence for immediate speech playback
      this.speechQueue.push(sentence);
      this.processSpeechQueue();

      this.currentAgentBubbleText = (this.currentAgentBubbleText + ' ' + sentence).trim();

      this.turnCounter += 1;
      const turnObj: PhoneBoothTurn = {
        turn: this.turnCounter,
        speaker: 'agent',
        text: this.currentAgentBubbleText,
        emotion: emotion,
        timestamp: Date.now()
      };

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
        currentEmotion: emotion
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
  }

  /**
   * Send student speech turn with automatic Barge-In (interruption) handling
   */
  public async sendStudentSpeech(text: string) {
    if (!text || text.trim().length === 0) return;

    // Barge-In: if AI is currently speaking, cut off speech immediately so student is heard!
    if (this.speechQueue.length > 0 || (typeof window !== 'undefined' && window.speechSynthesis.speaking)) {
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

    // 1. Sync student turn immediately to Firebase
    if (this.currentConversationKey) {
      try {
        const turnRef = push(ref(database, `conversations/${this.currentConversationKey}/transcript`));
        await set(turnRef, turnObj);
      } catch (e) {
        console.warn('Firebase student turn sync error:', e);
      }
    }

    // 2. Transmit to secondary laptop AI over WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'student_speech',
        text: text.trim()
      }));
    } else {
      console.warn('WebSocket not open. Preserving speech locally.');
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
      const isTeacher = currentSlots.category === 'teacher_involved' || (currentSlots.implicated_person && /teacher|staff|principal|coach|sir|madam|miss/i.test(currentSlots.implicated_person));
      const categoryVal = currentSlots.category || (isTeacher ? 'teacher_involved' : 'safety');
      const intensityVal = currentSlots.immediate_danger ? 'extreme' : 'medium';

      const reportPayload = {
        reportId: reportIdStr,
        reportNumber: this.currentReportNumber,
        category: categoryVal,
        intensity: intensityVal,
        description: currentSlots.summary || `Phone booth voice report (${durationSeconds}s call)`,
        location: currentSlots.location || SCHOOL_CONFIG.name,
        school: SCHOOL_CONFIG.name,
        isAnonymous: true,
        implicatedName: currentSlots.implicated_person || null,
        personType: isTeacher ? 'teacher' : 'student',
        source: 'phone_booth_voice_agent',
        conversationId: this.currentConversationKey,
        timestamp: serverTimestamp(),
        durationSeconds: durationSeconds,
        extractedSlots: currentSlots
      };

      // Push to standard reports or higher authority
      const targetNode = isTeacher ? 'higher_authority_reports' : 'reports';
      const pushed = await push(ref(database, targetNode), reportPayload);
      savedReportKey = pushed.key;

      console.log(`✅ Phone Booth report stored to Firebase at ${targetNode}/${savedReportKey}`);
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
