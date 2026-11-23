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
  private ttsVoice: SpeechSynthesisUtterance | null = null;

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
   * Speak agent response through browser speech synthesis
   */
  public speak(text: string, onEnd?: () => void) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95; // Gentle, understandable speed for kids
      utterance.pitch = 1.05; // Friendly, warm pitch
      utterance.lang = 'en-US';

      // Pick a warm natural voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Karen')) && v.lang.startsWith('en'));
      if (preferred) utterance.voice = preferred;

      this.notify({ isAgentSpeaking: true });

      utterance.onend = () => {
        this.notify({ isAgentSpeaking: false });
        if (onEnd) onEnd();
      };

      utterance.onerror = () => {
        this.notify({ isAgentSpeaking: false });
        if (onEnd) onEnd();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      this.notify({ isAgentSpeaking: false });
      if (onEnd) onEnd();
    }
  }

  public stopSpeaking() {
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

    // 2. Connect WebSocket
    return new Promise((resolve) => {
      try {
        console.log(`Connecting to Phone Booth AI Server: ${serverUrl}`);
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connection established with AI server');
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
   * Handle incoming AI speech & slot extraction packet
   */
  private async handleIncomingMessage(data: any) {
    if (data.type === 'agent_response') {
      const speech = data.speech || '';
      const emotion = data.detected_emotion || 'Comforting';
      const category = data.category_guess || 'other';
      const inquiryState = data.inquiry_state || 'acknowledging';
      const slots = data.slots || {};

      this.turnCounter += 1;
      const turnObj: PhoneBoothTurn = {
        turn: this.turnCounter,
        speaker: 'agent',
        text: speech,
        emotion: emotion,
        timestamp: Date.now()
      };

      // Append to Firebase live transcript
      if (this.currentConversationKey) {
        try {
          const turnRef = push(ref(database, `conversations/${this.currentConversationKey}/transcript`));
          await set(turnRef, turnObj);

          // Update current extracted slots and emotional state in Firebase
          await update(ref(database, `conversations/${this.currentConversationKey}`), {
            currentEmotion: emotion,
            categoryGuess: category,
            inquiryState: inquiryState,
            lastUpdated: serverTimestamp(),
            extractedSlots: slots
          });
        } catch (e) {
          console.warn('Firebase turn sync error:', e);
        }
      }

      this.notify({
        currentEmotion: emotion,
        categoryGuess: category,
        inquiryState: inquiryState,
        extractedSlots: slots
      });

      // Speak aloud to the child
      this.speak(speech);
    }
  }

  /**
   * Send student's spoken words to AI server and persist in Firebase
   */
  public async sendStudentSpeech(text: string) {
    if (!text || text.trim().length === 0) return;

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
      console.warn('WebSocket not open. Speech could not be transmitted to AI server.');
      this.notify({ error: 'AI server disconnected. Speech preserved locally.' });
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
