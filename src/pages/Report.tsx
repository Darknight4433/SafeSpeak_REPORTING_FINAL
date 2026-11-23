import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ref, push, serverTimestamp } from 'firebase/database';
import { database } from '@/lib/firebase';
import { getNextReportNumber, formatReportId } from '@/lib/reportUtils';
import { analyzeReport, analyzeReportDemo } from '@/lib/safeSpeakAI';
import { detectHighSeverityKeywords, makeSanitizedSnippet } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Shield, Phone, UserX, User, Users, AlertTriangle, BookOpen, Home, Heart, Mic, Bot, Sparkles, Volume2, VolumeX, CheckCheck, Settings, Wifi, Server, RefreshCw } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SCHOOL_CONFIG } from '@/config/school';
import { checkOllamaStatus, type OllamaStatus, getCustomOllamaHost, setCustomOllamaHost, testOllamaHost, getOllamaBaseUrl } from '@/lib/ollamaService';
import { PhoneBooth } from '@/components/PhoneBooth';
import type { ExtractedReportSlots } from '@/lib/phoneBoothService';


const categories = [
  { value: 'bullying', label: 'Bullying / Harassment', icon: Users },
  { value: 'abuse', label: 'Physical/Emotional Abuse', icon: AlertTriangle },
  { value: 'academic', label: 'Academic Pressure', icon: BookOpen },
  { value: 'family', label: 'Family Issues', icon: Home },
  { value: 'safety', label: 'Safety Concerns', icon: Shield },
  { value: 'other', label: 'Other', icon: Heart },
];

const intensityLevels = [
  { value: 'low', label: 'Low', description: 'Minor concern', color: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300' },
  { value: 'medium', label: 'Medium', description: 'Moderate concern', color: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-300' },
  { value: 'high', label: 'High', description: 'Serious concern', color: 'bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-300' },
  { value: 'extreme', label: 'Extreme', description: 'Critical/urgent', color: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300' },
];

const formSchema = z.object({
  category: z.string().min(1, 'Please select a category'),
  intensity: z.string().min(1, 'Please select an intensity level'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  age: z.string().optional(),
  location: z.string().optional(),
  name: z.string().optional(),
  contact: z.string().optional(),
  classroom: z.string().optional(),
  bullyName: z.string().optional(),
  implicatedName: z.string().optional(),
  isAnonymous: z.boolean().default(false),
  personType: z.string().optional(), // Student, Teacher, or Staff
}).superRefine((data, ctx) => {
  // If not anonymous, reporter name is required
  if (data.isAnonymous === false && (!data.name || data.name.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Your name is required when submitting a named report',
      path: ['name']
    });
  }

  // For teacher/staff cases, require the implicated person's name and the reporter's classroom
  if (data.personType === 'teacher' || data.personType === 'staff') {
    if (!data.implicatedName || data.implicatedName.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name of the teacher/staff member is required',
        path: ['implicatedName']
      });
    }
    if (!data.classroom || data.classroom.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Class/Section is required for teacher/staff reports',
        path: ['classroom']
      });
    }
  }

  // Bullying reports involving students should include the bully's name
  if (data.category === 'bullying' && data.personType !== 'teacher' && data.personType !== 'staff' && (!data.bullyName || data.bullyName.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Name of the person bullying is required (enter 'Unknown' if not known)",
      path: ["bullyName"]
    });
  }
});

const Report = () => {
  const [reportingMode, setReportingMode] = useState<'booth' | 'manual'>('booth');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [transcript, setTranscript] = useState("");
  const isRecordingRef = useRef(false);
  const inputModeRef = useRef<'text' | 'voice'>('text');
  // Timeout ref for post-submit reset so we can cancel on unmount
  const resetTimeoutRef = useRef<number | null>(null);

  // Clear any pending reset timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current as unknown as number);
        resetTimeoutRef.current = null;
      }
    };
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: '',
      intensity: '',
      description: '',
      age: '',
      location: SCHOOL_CONFIG.name, // Default school name from config
      name: '',
      contact: '',
      classroom: '',
      bullyName: '',
      implicatedName: '',
      isAnonymous: false, // Named report by default
      personType: 'student',
    },
  });

  // Watch selected category to conditionally show fields like bullyName
  const category = form.watch('category');

  const handleSwitchToTyping = (slots?: ExtractedReportSlots) => {
    if (slots) {
      if (slots.category) form.setValue('category', slots.category);
      if (slots.location) form.setValue('location', slots.location);
      if (slots.implicated_person) {
        form.setValue('implicatedName', slots.implicated_person);
        form.setValue('bullyName', slots.implicated_person);
      }
      if (slots.summary) form.setValue('description', slots.summary);
    }
    setReportingMode('manual');
    toast.info('Switched to manual typing. Extracted details pre-filled.');
  };

  // Map AI risk level to a friendly label shown to the user (neutral language)
  const mapRiskLabel = (r?: string) => {
    switch (r) {
      case 'L3':
        return 'High — immediate attention recommended';
      case 'L2':
        return 'Moderate — please consider follow-up';
      case 'L1':
        return 'Low — monitor and add details if needed';
      case 'L0':
        return 'No immediate risk detected';
      default:
        return 'Analyzing';
    }
  };

  // Short, friendly guidance the UI can show under the AI status
  const mapRiskAction = (r?: string) => {
    switch (r) {
      case 'L3':
        return "This looks serious — please include the child's name, class, and school so we can escalate, or contact a trusted adult/helpline if there's immediate danger.";
      case 'L2':
        return 'Consider contacting a trusted adult or school counselor and add more details to help our team follow up.';
      case 'L1':
        return 'Our team will review this; you can submit now or add more details for clarity.';
      case 'L0':
      default:
        return 'You can submit the report; our team will review and reach out if necessary.';
    }
  };

  // Initialize speech recognition via abstraction
  useEffect(() => {
    // Lazy import of our abstraction
    import('@/lib/speech').then(({ createRecognition }) => {
      const instance = createRecognition({ lang: 'en-US', continuous: true, interimResults: true });

      if (!instance.isSupported) {
        console.log('Speech recognition not supported in this environment');
        toast.error('Speech recognition is not supported in this browser.');
        return;
      }

      instance.onStart = () => {
        console.log('Speech recognition started');
        setIsRecording(true);
        isRecordingRef.current = true;
      };

      instance.onResult = (transcript: string) => {
        console.log('Transcript:', transcript);
        setTranscript(transcript);
        form.setValue('description', transcript);
      };

      instance.onError = (event: any) => {
        console.error('Speech recognition error:', event);

        // Mirror existing behavior for aborted/no-speech
        if (event?.error === 'aborted' || event?.error === 'no-speech') {
          if (event?.error === 'no-speech' && isRecordingRef.current) {
            console.log('No speech detected, restarting...');
            setTimeout(() => {
              if (isRecordingRef.current) {
                try {
                  instance.start();
                } catch (e) {
                  console.log('Restart failed:', e);
                }
              }
            }, 300);
          }
          return;
        }

        setIsRecording(false);
        isRecordingRef.current = false;

        // Provide more helpful messages for common errors and include any event detail
        let errorMessage = 'Recording failed. ';
        const err = event?.error || event;
        switch (err) {
          case 'audio-capture':
            errorMessage = 'No microphone found. Please check your device.';
            break;
          case 'not-allowed':
          case 'PermissionDeniedError':
            errorMessage = 'Microphone access denied. Please allow microphone access in your browser settings.';
            break;
          case 'network':
            errorMessage = 'Network error. Please check your connection.';
            break;
          default:
            const extra = typeof err === 'object' ? (err?.message || JSON.stringify(err)) : String(err);
            errorMessage = `Error: ${extra}. Try reloading or use Chrome/Edge.`;
        }
        toast.error(errorMessage, { duration: 7000 });
      };

      instance.onEnd = () => {
        console.log('Speech recognition ended, should restart?', isRecordingRef.current, 'mode:', inputModeRef.current);

        // Force restart for continuous recording on Pi or native continuous mode
        if (isRecordingRef.current && inputModeRef.current === 'voice') {
          console.log('Force restarting for continuous mode...');
          setTimeout(() => {
            if (isRecordingRef.current && inputModeRef.current === 'voice') {
              try {
                instance.start();
                console.log('Successfully restarted');
              } catch (error) {
                console.log('Failed to restart, will retry:', error);
                setTimeout(() => {
                  if (isRecordingRef.current) {
                    try {
                      instance.start();
                    } catch (e) {
                      console.error('Final restart failed:', e);
                      setIsRecording(false);
                      isRecordingRef.current = false;
                    }
                  }
                }, 500);
              }
            }
          }, 200);
        } else {
          setIsRecording(false);
          isRecordingRef.current = false;
        }
      };

      setRecognition(instance);

      // Cleanup
      return () => {
        try { instance.stop(); } catch (e) { /* ignore */ }
        isRecordingRef.current = false;
      };
    }).catch((err) => {
      console.error('Failed to load speech abstraction:', err);
      toast.error('Speech recognition cannot be initialized.');
    });
  }, [form]);

  const startRecording = async () => {
    if (!recognition || !recognition.isSupported) {
      toast.error('Speech recognition is not supported on this device or environment. Try using Chrome or Edge for best compatibility.');
      return;
    }

    try {
      // Do NOT clear the transcript here so restarting recognition doesn't lose already captured text
      // For web, ensure we have microphone permission first
      if ((recognition as any).type === 'web') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
        } catch (permErr) {
          // If permission denied, bubble up a clearer message
          console.error('getUserMedia permission error:', permErr);
          throw permErr;
        }
      }

      await (recognition as any).start();
      setIsRecording(true);
      isRecordingRef.current = true;
      toast.success('🎤 Recording... Speak now!');
    } catch (error: any) {
      console.error('Microphone permission error:', error);
      const name = error?.name || error?.code || 'unknown_error';
      // Provide a helpful message for common errors
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        toast.error('Microphone access denied. Please allow microphone access in your browser settings and reload the page.', { duration: 7000 });
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        toast.error('No microphone found. Please connect a microphone and try again.', { duration: 7000 });
      } else {
        toast.error(`Failed to access microphone: ${name}. Try reloading the page or use Chrome/Edge.`, { duration: 7000 });
      }
    }
  };

  const stopRecording = () => {
    if (recognition && isRecording) {
      isRecordingRef.current = false; // Set ref FIRST
      setIsRecording(false);
      recognition.stop();
    }
  };

  // Auto-start recording when voice mode is selected
  useEffect(() => {
    inputModeRef.current = inputMode;

    if (inputMode === 'voice' && !isRecording && recognition) {
      startRecording();
    } else if (inputMode === 'text' && isRecording) {
      stopRecording();
    }
  }, [inputMode, recognition]);

  // Sync recording state with ref
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Recorder fallback state
  const [isRecFallbackRecording, setIsRecFallbackRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Live detection while typing
  const [liveKeyword, setLiveKeyword] = useState<{ matched: boolean; reason?: string; patternId?: string } | null>(null);
  const [liveAiAnalysis, setLiveAiAnalysis] = useState<any>(null);
  const [isLiveAiLoading, setIsLiveAiLoading] = useState(false);
  const [liveAiError, setLiveAiError] = useState<string | null>(null);
  const descriptionValue = form.watch('description');

  // Push error state for debugging failed Firebase writes (shown in UI as dismissible banner)
  const [lastPushError, setLastPushError] = useState<string | null>(null);

  // Pending writes stored locally when push fails (so reports aren't lost)
  const [pendingCount, setPendingCount] = useState(0);

  const PENDING_KEY = 'ss_pending_reports_v1';

  const loadPending = (): any[] => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return [];
      return JSON.parse(raw) || [];
    } catch (e) { console.error('Failed to read pending reports:', e); return []; }
  };

  const savePending = (arr: any[]) => {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); setPendingCount(arr.length); } catch (e) { console.error('Failed to save pending reports:', e); }
  };

  const enqueuePending = (path: string, payload: any, silent = false) => {
    const arr = loadPending();
    arr.push({ path, payload, ts: Date.now() });
    savePending(arr);
    if (!silent) {
      toast.info('Report saved locally and will be retried automatically when connection is restored.');
    }
  };

  const clearPending = () => { savePending([]); };

  useEffect(() => { setPendingCount(loadPending().length); }, []);

  // Retry pending writes when online or when user clicks retry
  const retryPendingWrites = async () => {
    const arr = loadPending();
    if (!arr || arr.length === 0) {
      toast.success('No pending reports to retry.');
      return;
    }
    toast.loading('Retrying pending reports...', { id: 'retry-toast' });
    const results: any[] = [];
    for (const item of arr) {
      try {
        const r = ref(database, item.path);
        const res = await push(r, item.payload);
        results.push({ ok: true, key: res?.key });
      } catch (err) {
        console.error('Retry push failed for', item, err);
        results.push({ ok: false, err: String(err).slice(0, 200) });
      }
    }
    // Keep only the failed ones
    const failed = arr.filter((_, i) => !results[i]?.ok);
    savePending(failed);
    toast.dismiss('retry-toast');
    if (failed.length === 0) {
      toast.success('All pending reports have been submitted.');
    } else {
      toast.error(`${failed.length} reports still pending after retry.`);
    }
    setPendingCount(failed.length);
  };

  useEffect(() => {
    const onOnline = () => { if (loadPending().length > 0) retryPendingWrites(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);


  // AI mode & Ollama background LLM state
  const [demoAiEnabled, setDemoAiEnabled] = useState<boolean>(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  // Remote / Laptop AI Server connection state
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [customHostInput, setCustomHostInput] = useState(getCustomOllamaHost() || '');
  const [isTestingHost, setIsTestingHost] = useState(false);
  const [testHostFeedback, setTestHostFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const refreshOllamaStatus = async () => {
    try {
      const status = await checkOllamaStatus();
      setOllamaStatus(status);
      return status;
    } catch {
      const fallback = { available: false, models: [], selectedModel: 'llama3.2:1b', endpoint: getOllamaBaseUrl() };
      setOllamaStatus(fallback);
      return fallback;
    }
  };

  const handleTestHost = async () => {
    setIsTestingHost(true);
    setTestHostFeedback(null);
    try {
      const target = customHostInput.trim() || 'http://127.0.0.1:11434';
      const res = await testOllamaHost(target);
      if (res.success) {
        setTestHostFeedback({
          success: true,
          message: `Connected! Available models: ${res.models.slice(0, 3).join(', ') || 'ready'}`
        });
      } else {
        setTestHostFeedback({
          success: false,
          message: res.error || 'Could not reach server. Ensure Ollama is running on your laptop with OLLAMA_HOST=0.0.0.0'
        });
      }
    } catch (e: any) {
      setTestHostFeedback({ success: false, message: e.message || 'Connection test failed' });
    } finally {
      setIsTestingHost(false);
    }
  };

  const handleSaveHost = async () => {
    setCustomOllamaHost(customHostInput.trim() || null);
    setAiSettingsOpen(false);
    const updated = await refreshOllamaStatus();
    if (updated.available) {
      toast.success(`Connected to AI Server on ${updated.endpoint}`);
    } else {
      toast.info(`Configured ${getOllamaBaseUrl()}. SafeSpeak local rule analyzer is active.`);
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('demoAi');
      if (saved !== null) {
        setDemoAiEnabled(saved === '1');
      }
    } catch (e) { }

    // Check Ollama connection on component mount
    refreshOllamaStatus().then((status) => {
      if (status.available) {
        console.log(`🦙 Ollama connected (${status.selectedModel}) via ${status.endpoint}`);
      } else {
        console.log(`ℹ️ Ollama not running: ${status.error || 'offline'}. Local rule analyzer ready.`);
      }
    });
  }, []);

  // EFFECT: Enforce Named Reporting when Teacher/Staff involved
  const personTypeWatcher = form.watch('personType');
  useEffect(() => {
    const isTeacherInvolved = liveKeyword?.patternId === 'teacher_involved';
    if (isTeacherInvolved) {
      if (personTypeWatcher !== 'teacher') {
        form.setValue('personType', 'teacher');
      }
      if (isAnonymous) {
        setIsAnonymous(false);
        form.setValue('isAnonymous', false);
      }
    }
  }, [liveKeyword, personTypeWatcher, isAnonymous, form]);

  // EFFECT: When user explicitly selects Teacher or Staff, treat it like a manual detection
  useEffect(() => {
    try {
      const pt = personTypeWatcher;
      if (pt === 'teacher' || pt === 'staff') {
        // If description doesn't already indicate teacher involvement, set liveKeyword to indicate user's selection
        if (liveKeyword?.patternId !== 'teacher_involved') {
          setLiveKeyword({ matched: true, patternId: 'teacher_involved', reason: 'User selected Teacher/Staff' });
        }
        // Ensure named reporting for teacher/staff selections
        if (isAnonymous) {
          setIsAnonymous(false);
          form.setValue('isAnonymous', false);
        }
        // Inform the user gently
        toast.info('Teacher/Staff selected — please provide the teacher/staff name and your class so we can escalate appropriately.');
      } else {
        // If user switched back to student and the liveKeyword was only from the manual selection, clear it
        if (liveKeyword?.patternId === 'teacher_involved' && liveKeyword.reason === 'User selected Teacher/Staff') {
          setLiveKeyword(null);
        }
      }
    } catch (e) {
      console.error('Error in personType watcher effect:', e);
    }
  }, [personTypeWatcher]);



  // Auto-disable anonymity if user types their name
  // This prevents the "Escalation Dialog" from appearing unnecessarily if the user already identified themselves.
  const nameWatcher = form.watch('name');
  useEffect(() => {
    if (nameWatcher && nameWatcher.trim().length > 0 && isAnonymous) {
      setIsAnonymous(false);
      form.setValue('isAnonymous', false);
    }
  }, [nameWatcher, isAnonymous, form]);

  // Manual AI test helper (called by UI button)
  const testAiNow = async () => {
    const text = descriptionValue || '';
    if (!text || text.trim().length < 10) {
      toast.error('Please enter a bit more detail for the AI to analyze.');
      return;
    }

    setIsLiveAiLoading(true);
    setLiveAiError(null);
    try {
      const res = demoAiEnabled
        ? await analyzeReportDemo(text)
        : await analyzeReport(text, { model: ollamaStatus?.selectedModel });
      setLiveAiAnalysis(res);
      const engineName = res?.details?.source === 'ollama' ? `Ollama (${res?.details?.model})` : 'Rules/Memory';
      toast.success(`AI check completed via ${engineName}: ${res?.risk_level || 'Unknown'}`);
    } catch (err) {
      console.error('Manual AI check failed:', err);
      // Keep UX neutral: do not show alarming error messages to users — allow retry via "Check AI now"
      setLiveAiError('unavailable');
    } finally {
      setIsLiveAiLoading(false);
    }
  };

  // TTS Voice Reassurance for students
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speakSupportMessage = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.info('Voice readout is not supported in this browser.');
      return;
    }
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9; // Calm, gentle pacing for children
    utterance.pitch = 1.05; // Soothing, friendly tone
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // Auto-fill category & intensity based on what the student expressed
  const applyAiSuggestionsToForm = () => {
    if (!liveAiAnalysis) return;
    const cat = liveAiAnalysis.category;
    if (cat) {
      if (cat.includes('bully')) form.setValue('category', 'bullying');
      else if (cat.includes('academic')) form.setValue('category', 'academic');
      else if (cat.includes('threat') || cat.includes('physical') || cat.includes('abuse')) form.setValue('category', 'abuse');
      else if (cat.includes('self_harm') || cat.includes('safety')) form.setValue('category', 'safety');
      else form.setValue('category', 'other');
    }
    if (liveAiAnalysis.risk_level) {
      const mapIntensity: Record<string, string> = {
        L3: 'extreme',
        L2: 'high',
        L1: 'medium',
        L0: 'low',
      };
      form.setValue('intensity', mapIntensity[liveAiAnalysis.risk_level] || 'medium');
    }
    if (liveAiAnalysis.category === 'teacher_involved' || liveAiAnalysis.details?.rule_triggered) {
      form.setValue('personType', 'teacher');
    }
    toast.success('Form automatically updated to match what you expressed!');
  };

  // Dev-only self-test: runs through detection and analysis logic without pushing to Firebase
  const selfTestNow = async () => {
    try {
      toast.loading('Running quick self-test...', { id: 'selftest-toast' });
      const samples = [
        { label: 'Teacher harmed', text: 'tr harassed me very badly' },
        { label: 'Teacher helper', text: 'my teacher saved me from the boy' },
        { label: 'Teacher mentioned neutrally', text: 'my teacher is nice' },
        { label: 'Other violence', text: 'the boy hit me' }
      ];

      const results: any[] = [];

      for (const s of samples) {
        const kw = detectHighSeverityKeywords(s.text);
        let aiResult: any = null;
        try {
          aiResult = demoAiEnabled ? await analyzeReportDemo(s.text) : await analyzeReport(s.text);
        } catch (err) {
          console.warn('Self-test AI call failed for', s.text, err);
          aiResult = null;
        }
        const isTeacherInvolved = kw?.patternId === 'teacher_involved';
        const escalate = (aiResult && aiResult.risk_level === 'L3') || isTeacherInvolved || kw?.matched;
        results.push({ label: s.label, text: s.text, kw, aiResult, escalate });

        // In dev, attempt a dry push to see failure mode for debugging
        if (process.env.NODE_ENV !== 'production') {
          const dryPayload = { reportId: 'dryrun', reportNumber: 0, category: 'selftest', description: s.text, timestamp: serverTimestamp(), status: escalate ? 'escalated' : 'pending' };
          const res = await (async () => {
            try {
              return await (async function () { const r = ref(database, 'reports'); return await push(r, dryPayload); })();
            } catch (err) {
              console.warn('Dry push failed (expected in some environments):', err);
              // setLastPushError will be set via safePush in normal flow; here show console only
              return null;
            }
          })();
          console.log('Dry push result for', s.label, res?.key || null);
        }
      }

      console.table(results);
      toast.dismiss('selftest-toast');
      toast.success('Self-test completed; check console for detailed results.');
    } catch (err) {
      console.error('Self-test failed:', err);
      toast.dismiss('selftest-toast');
      toast.error('Self-test failed — check console for details.');
    }
  };

  // Inline fallback component
  function RecordFallback() {
    // Lazy import to keep bundle small
    const start = async () => {
      try {
        const { createRecorder, transcribeUsingConfig } = await import('@/lib/audioRecorder');

        const recorder = createRecorder();
        await recorder.start();
        setIsRecFallbackRecording(true);

        // Attach to window so dev can stop via console if needed
        (window as any).__ss_recorder = recorder;

        // Wait for stop triggered by user
        (document as any).__stopRecorder = async () => {
          if (!recorder.isRecording()) return;
          const blob = await recorder.stop();
          setIsRecFallbackRecording(false);
          setIsTranscribing(true);
          try {
            const transcript = await transcribeUsingConfig(blob);
            if (transcript) {
              setTranscript(transcript);
              form.setValue('description', transcript);
              toast.success('Voice transcription complete');
            } else {
              toast.info('No speech detected. Please speak clearly into the microphone.');
            }
          } catch (err: any) {
            console.error('Transcription error:', err);
            toast.error('Voice transcription unavailable. Type your message or run Vosk STT server.');
          } finally {
            setIsTranscribing(false);
            // cleanup
            delete (window as any).__ss_recorder;
            delete (document as any).__stopRecorder;
          }
        };
      } catch (err: any) {
        console.error('Recorder init failed:', err);
        toast.error('Recorder not available on this device');
      }
    };

    const stop = async () => {
      try {
        // If recorder exists on window
        const recorder = (window as any).__ss_recorder;
        if (recorder && recorder.isRecording()) {
          // call the stored stop handler
          await (document as any).__stopRecorder();
        }
      } catch (e) {
        console.error('Stop failed:', e);
      }
    };

    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={start}
            disabled={isRecFallbackRecording || isTranscribing}
          >
            {isRecFallbackRecording ? 'Recording...' : 'Start Recording'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={stop}
            disabled={!isRecFallbackRecording || isTranscribing}
          >
            Stop & Transcribe
          </Button>
        </div>
        {isTranscribing && <div className="text-sm text-muted-foreground">Transcribing audio…</div>}
      </div>
    );
  }

  // Live detection effect: run keyword detection immediately and debounce AI analysis
  useEffect(() => {
    try {
      const kw = detectHighSeverityKeywords(descriptionValue || '');
      setLiveKeyword(kw);
    } catch (e) {
      setLiveKeyword(null);
    }

    let id: any = null;
    if (descriptionValue && descriptionValue.trim().length >= 12) {
      setIsLiveAiLoading(true);
      setLiveAiError(null);
      id = setTimeout(async () => {
        try {
          const res = demoAiEnabled
            ? await analyzeReportDemo(descriptionValue)
            : await analyzeReport(descriptionValue, { model: ollamaStatus?.selectedModel });
          setLiveAiAnalysis(res);
        } catch (err: any) {
          console.error('Live AI analysis failed:', err);
          // Do not expose raw error messages to users
          setLiveAiError('unavailable');
          setLiveAiAnalysis(null);
        } finally {
          setIsLiveAiLoading(false);
        }
      }, 1200);
    } else {
      setLiveAiAnalysis(null);
      setIsLiveAiLoading(false);
      setLiveAiError(null);
    }

    return () => { if (id) clearTimeout(id); };
  }, [descriptionValue, demoAiEnabled, ollamaStatus?.selectedModel]);

  // State to manage escalation confirmation
  const [escalationOpen, setEscalationOpen] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<any>(null);
  // Non-blocking escalation banner for non-teacher escalations (lets user submit anonymously)
  const [escalationBannerOpen, setEscalationBannerOpen] = useState(false);

  async function finishSubmission({ values, reportNumber, reportId, aiAnalysis, keywordCheck }: any) {
    try {
      // If this is a teacher/staff report, send only to Higher Authority queue (do NOT add to admin 'reports' queue)
      const isTeacherInvolved = keywordCheck?.patternId === 'teacher_involved';

      // Prefer canonical school for teacher reports, keep original location for audit
      const schoolName = isTeacherInvolved ? 'MGM Model School Ayiroor Varkala' : (values.location || null);

      const reportDataBase = {
        reportId,
        reportNumber,
        ...values,
        original_location: values.location || null,
        school: schoolName,
        timestamp: serverTimestamp(),
        status: isTeacherInvolved ? 'escalated' : 'received',
        // Add AI data if available
        aiAnalysis: aiAnalysis || { status: 'failed', note: 'AI Server unreachable' },
        // Use AI risk level if available, otherwise fallback to user's intensity or calculate/default
        riskLevel: aiAnalysis ? aiAnalysis.risk_level : 'Manual Review',
        aiScore: aiAnalysis ? aiAnalysis.risk_score : 0,
        // Attach any discovered overrides (from AI or client-side keyword detector)
        override: aiAnalysis?.override ?? (keywordCheck?.matched ? {
          type: 'keyword',
          patternId: keywordCheck?.patternId || keywordCheck?.reason?.toLowerCase()?.replace(/\s+/g, '_') || 'keyword',
          reason: keywordCheck?.reason || 'keyword',
          snippet: makeSanitizedSnippet(values.description)
        } : undefined)
      };

      console.log('Submitting to Firebase...', reportDataBase);

      let pushedRef = null;

      // Safe push helper with debug logging and retry logic so we attempt a few times before falling back to local save
      const safePush = async (path: string, payload: any) => {
        const maxRetries = 10; // Increased for slower connections
        const baseDelay = 800; // ms
        const toastId = `submit-${payload?.reportId || Date.now()}`;
        let attempt = 0;

        while (attempt < maxRetries) {
          attempt += 1;
          try {
            console.log(`🔄 Attempt ${attempt} push to ${path}...`, { payload });
            // Only show loading on first few attempts to avoid annoyance
            if (attempt === 1) toast.loading(`Submitting report...`, { id: toastId });

            const r = ref(database, path);
            const res = await push(r, payload);
            console.log(`✅ push ${path} succeeded on attempt ${attempt}`, res?.key);
            toast.dismiss(toastId);
            toast.success('Report submitted successfully.', { duration: 4000 });
            setLastPushError(null);
            return res;
          } catch (err: any) {
            const code = err?.code || err?.name || 'unknown_error';
            const message = err?.message || String(err);
            console.error(`❌ push ${path} failed attempt ${attempt}:`, { code, message, fullError: err });

            if (attempt >= maxRetries) {
              const short = `${code}: ${message}`.slice(0, 220);
              // After all retries fail, save locally and inform the user
              try { enqueuePending(path, payload, true); } catch (e) { console.error('enqueuePending failed:', e); }
              setPendingCount(loadPending().length);
              toast.dismiss(toastId);
              // Use warning instead of error so user knows it's safe
              toast.warning('Network unstable — report saved to device. We will send it automatically.', { duration: 7000 });
              console.warn(`Saved report locally for retry (push ${path} failed after ${maxRetries} attempts): ${short}`);
              return null;
            }

            // Wait with exponential backoff before retrying
            const delay = baseDelay * Math.pow(1.5, attempt - 1); // Gentler backoff
            await new Promise((res) => setTimeout(res, delay));
          }
        }

        return null;
      };

      // For teacher/staff implicated reports, skip adding to the general admin 'reports' queue and send directly to higher_authority_reports
      if (!isTeacherInvolved) {
        pushedRef = await safePush('reports', reportDataBase);
        console.log('Report submitted successfully to reports/', pushedRef?.key);
      } else {
        console.log('Teacher/staff report - skipping admin reports/ and escalating directly.');
      }

      const shouldEscalate = (aiAnalysis && aiAnalysis.risk_level === 'L3') || keywordCheck?.matched || (values?.intensity === 'extreme') || isTeacherInvolved;

      let higherResult: any = null;

      if (shouldEscalate) {
        try {
          const escalatedBy = isTeacherInvolved ? 'teacher_keyword' : (values?.intensity === 'extreme' ? 'user' : (aiAnalysis ? 'ai' : 'keyword_fallback'));
          const escalatedReason = isTeacherInvolved ? (keywordCheck?.reason || 'teacher_involved') : (values?.intensity === 'extreme' ? 'user_selected_extreme' : (aiAnalysis ? (aiAnalysis.route_to || aiAnalysis.risk_level) : (keywordCheck?.reason || 'keyword')));
          const escalationMeta = {
            escalated_by: escalatedBy,
            escalated_reason: escalatedReason,
            original_report_key: pushedRef?.key || null,
            timestamp: serverTimestamp(),
            override: reportDataBase.override || null
          };

          higherResult = await safePush('higher_authority_reports', { ...reportDataBase, escalationMeta });
          console.log('Escalated to higher_authority_reports', escalationMeta, higherResult?.key);
          if (higherResult) {
            toast.success('Report automatically escalated to Higher Authority for immediate review.', { duration: 7000 });
          }
        } catch (escErr) {
          console.error('Failed to escalate to higher authority:', escErr);
          toast.error('Failed to escalate automatically. Please contact admin.', { duration: 7000 });
        }
      }

      // Dismiss loading
      toast.dismiss('submit-toast');

      if (pushedRef || (shouldEscalate && pushedRef === null)) {
        // If we have a key (successful push) OR it was an escalation (which might have its own separate push)
        // Note: effectively if safePush returns null, it's offline.

        const isSuccess = pushedRef || (shouldEscalate && higherResult);

        if (isSuccess) {
          toast.success(`Report received! Your ID: ${reportId}`, { duration: 7000 });
        } else {
          toast.warning(`Report saved on device. We'll auto-send it when online.`, { duration: 7000 });
        }
      }

      // Smooth reset with delay
      try {
        resetTimeoutRef.current = window.setTimeout(() => {
          try {
            form.reset();
            setIsAnonymous(false);
            setInputMode('text');
            inputModeRef.current = 'text';
            setTranscript('');
          } catch (innerErr) {
            console.error('Error during post-submit reset:', innerErr);
          }
          resetTimeoutRef.current = null;
        }, 500);
      } catch (err) {
        console.error('Failed to schedule post-submit reset:', err);
      }
    } catch (err: any) {
      // Catch any unexpected errors that may have propagated and prevent them from crashing the app
      console.error('Unexpected error in finishSubmission:', err);
      try { toast.error('An unexpected error occurred while submitting your report. Please try again.'); } catch (e) { }
    }
  }

  const confirmEscalation = async () => {
    // Validate name and classroom are provided
    const name = form.getValues('name')?.trim();
    const classroom = form.getValues('classroom')?.trim();
    const bullyName = form.getValues('bullyName')?.trim();
    const implicatedName = form.getValues('implicatedName')?.trim();
    let ok = true;
    if (!name) {
      form.setError('name', { type: 'required', message: 'Name is required for escalated reports' });
      ok = false;
    }
    if (!classroom) {
      form.setError('classroom', { type: 'required', message: 'Class/Section is required for escalated reports involving staff or teachers' });
      ok = false;
    }

    // If this pending submission is a bullying report, require the bully's name too
    if (pendingSubmission?.values?.category === 'bullying' && !bullyName) {
      form.setError('bullyName', { type: 'required', message: "Name of the person bullying is required for escalated bullying reports" });
      ok = false;
    }

    // If this pending submission involves a teacher or staff, require the implicated person's name
    if (pendingSubmission?.values?.personType && (pendingSubmission.values.personType === 'teacher' || pendingSubmission.values.personType === 'staff') && !implicatedName) {
      form.setError('implicatedName', { type: 'required', message: 'Name of the teacher/staff member is required for escalation' });
      ok = false;
    }

    // Require a bit more detail in the description for escalated reports so investigators have usable context
    const desc = pendingSubmission?.values?.description || '';
    if (!desc || desc.trim().length < 20) {
      form.setError('description', { type: 'required', message: 'Please add more details about what happened so our team can investigate properly' });
      toast.error('Please add more detail in the description before we can escalate this report.');
      ok = false;
    }

    if (!ok) return;

    // Proceed: mark as named report and finish submission
    form.setValue('isAnonymous', false);
    setIsAnonymous(false);
    setEscalationOpen(false);

    if (!pendingSubmission) return;

    const updatedValues = { ...pendingSubmission.values, name, classroom, bullyName, implicatedName, isAnonymous: false };
    const { reportNumber, reportId, aiAnalysis, keywordCheck } = pendingSubmission;
    setPendingSubmission(null);

    try {
      setIsSubmitting(true);
      await finishSubmission({ values: updatedValues, reportNumber, reportId, aiAnalysis, keywordCheck });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit anonymously handler (user chooses to proceed anonymously despite escalation suggestion)
  const submitAnonymouslyFromEscalation = async () => {
    if (!pendingSubmission) return;

    const { values, reportNumber, reportId, aiAnalysis, keywordCheck } = pendingSubmission;

    // Close dialog and clear pending state
    setEscalationOpen(false);
    setPendingSubmission(null);

    // Mark the report as proceeding anonymously due to user override
    const updatedValues = { ...values, anonymousEscalationOverride: true };

    try {
      setIsSubmitting(true);
      await finishSubmission({ values: updatedValues, reportNumber, reportId, aiAnalysis, keywordCheck });
      toast.success('Submitted anonymously. Our team will review this report urgently.');
    } catch (err) {
      console.error('Failed to submit anonymously from escalation dialog:', err);
      toast.error('Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelEscalation = () => {
    setEscalationOpen(false);
    setPendingSubmission(null);
    toast.info('Submission paused. You can edit your report or contact a counselor for help.');
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);

    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }

    try {
      console.log('Starting report submission...', { category: values.category, isAnonymous: values.isAnonymous });

      // Show optimistic loading toast
      toast.loading('Submitting your report securely...', { id: 'submit-toast' });

      const reportNumber = await getNextReportNumber();
      const reportId = formatReportId(reportNumber);

      console.log('Generated report ID:', reportId);

      // --- AI INTEGRATION START ---
      let aiAnalysis = null;
      try {
        console.log("🧠 Sending to SafeSpeak AI (Ollama / Local Engine)...");
        toast.loading("AI is analyzing risk levels...", { id: 'ai-toast' });

        aiAnalysis = demoAiEnabled
          ? await analyzeReportDemo(values.description)
          : await analyzeReport(values.description, { model: ollamaStatus?.selectedModel });

        console.log("✅ AI Analysis Complete:", aiAnalysis);
        toast.dismiss('ai-toast');
        const sourceLabel = aiAnalysis?.details?.source === 'ollama' ? `Ollama (${aiAnalysis?.details?.model})` : 'AI Classifier';
        toast.success(`${sourceLabel}: Level ${aiAnalysis.risk_level}`, { duration: 3000 });
      } catch (aiError) {
        console.error("⚠️ AI Analysis failed, proceeding anyway:", aiError);
        toast.dismiss('ai-toast');
      }
      // --- AI INTEGRATION END ---

      const keywordCheck = detectHighSeverityKeywords(values.description || '');

      // Debug: show keyword detection and AI analysis so we can trace why escalation did or did not occur
      console.log('Keyword check result:', keywordCheck, 'AI analysis:', aiAnalysis);

      // Teacher/staff reports should always escalate to higher authority immediately
      let isTeacherInvolved = keywordCheck?.patternId === 'teacher_involved' || values.personType === 'teacher' || values.personType === 'staff';

      // If user selected Student and no teacher keyword was detected, treat as student dispute
      if (values.personType === 'student' && keywordCheck?.patternId !== 'teacher_involved') {
        isTeacherInvolved = false;
        if (keywordCheck) keywordCheck.patternId = 'student_dispute_override';
      }

      // Determine escalation - include teacher_involved explicitly
      const shouldEscalate = (aiAnalysis && aiAnalysis.risk_level === 'L3') || keywordCheck.matched || isTeacherInvolved || (values?.intensity === 'extreme');
      console.log('Escalation decision:', { shouldEscalate, isTeacherInvolved, intensity: values.intensity, isAnonymous: values.isAnonymous, personType: values.personType });

      // If teacher detection flagged it, but user hasn't selected a person type yet, require them to clarify
      if (keywordCheck?.patternId === 'teacher_involved' && !values.personType) {
        console.log('⚠️ Missing person type clarification');
        setIsSubmitting(false);
        form.setError('personType', { type: 'required', message: 'Please specify if this person is a Student, Teacher, or Staff' });
        toast.error('Please clarify if this person is a Student, Teacher, or Staff member.');
        return;
      }

      // If teacher is involved (and confirmed as Teacher/Staff), require identity details (name, class) before escalation (school is taken from config)
      if (isTeacherInvolved) {
        console.log('🎯 Teacher involved detected!');
        const hasInfo = values.name && values.name.trim() && values.classroom && values.classroom.trim() && values.implicatedName && values.implicatedName.trim();
        console.log('📋 Has required info?', { hasInfo, name: values.name, classroom: values.classroom, implicatedName: values.implicatedName });

        if (!hasInfo) {
          // Show error and stop submission - user must fill fields in main form
          console.log('⚠️ Missing required info for teacher report');
          setIsSubmitting(false);

          // Set errors on the form fields
          if (!values.name || !values.name.trim()) {
            form.setError('name', { type: 'required', message: 'Your name is required for teacher/staff reports' });
          }
          if (!values.classroom || !values.classroom.trim()) {
            form.setError('classroom', { type: 'required', message: 'Class is required for teacher/staff reports' });
          }
          if (!values.implicatedName || !values.implicatedName.trim()) {
            form.setError('implicatedName', { type: 'required', message: 'Name of the teacher/staff member is required for escalation' });
          }

          toast.error('Teacher/staff detected: Please provide your name, class, and the name of the teacher/staff involved to submit this report.');
          return;
        }

        // Proceed with escalation using provided details
        console.log('✅ All info provided - proceeding with submission');
        try {
          form.setValue('isAnonymous', false);
          setIsAnonymous(false);
          setIsSubmitting(true);
          await finishSubmission({ values: { ...values, isAnonymous: false }, reportNumber, reportId, aiAnalysis, keywordCheck });
          return;
        } catch (err) {
          console.error('Failed to escalate teacher report:', err);
          toast.error('Escalation failed. Please try again or contact support.');
          setIsSubmitting(false);
          return;
        }
      }

      // If escalation is needed and user chose anonymous, require identification before proceeding
      if (shouldEscalate && values.isAnonymous) {
        // Save pending submission
        setPendingSubmission({ values, reportNumber, reportId, aiAnalysis, keywordCheck });
        setIsSubmitting(false);

        // If teacher/staff is implicated, keep the blocking dialog requiring details
        if (isTeacherInvolved) {
          setEscalationOpen(true);
          toast.error('Teacher/staff detected: please provide your Name and Class to proceed with escalation.');
          return;
        }

        // For other escalations, show the blocking interaction so users can either provide details or submit anonymously
        setEscalationOpen(true);
        if (values.category === 'bullying') {
          toast.error("Serious threat detected. Please provide details in the popup, or confirm anonymous submission.");
        } else {
          toast.error("Serious threat detected. Please provide details in the popup, or confirm anonymous submission.");
        }

        return;
      }

      // If escalation is needed and reporter is NOT anonymous (immediate submission path), enforce requirements
      // For bullying reports, require the bully's name to proceed
      if (shouldEscalate && !values.isAnonymous && values.category === 'bullying' && (!values.bullyName || !values.bullyName.trim())) {
        setIsSubmitting(false);
        form.setError('bullyName', { type: 'required', message: 'Name of the person bullying is required for escalated bullying reports' });
        toast.error('Please provide the name of the person bullying to proceed.');
        return;
      }

      // Otherwise continue to finish submission
      await finishSubmission({ values, reportNumber, reportId, aiAnalysis, keywordCheck });

    } catch (error: any) {
      console.error('❌ Error submitting report:', error);
      console.error('Error details:', {
        message: error?.message,
        code: error?.code,
        stack: error?.stack
      });

      toast.dismiss('submit-toast');

      let errorMessage = 'Failed to submit report. ';
      if (error?.message?.includes('Firebase')) {
        errorMessage += 'Please check Firebase configuration. See FIREBASE_SETUP.md for help.';
      } else {
        errorMessage += 'Please try again.';
      }

      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <Navbar />
      <main className="flex-1 py-12 px-4">
        <div className="container max-w-4xl mx-auto space-y-8">

          {/* Firebase write error banner (dismissible) */}
          {lastPushError && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 flex items-start justify-between gap-4">
              <div className="text-sm">
                <div className="font-semibold">Error saving report</div>
                <div className="text-xs text-muted-foreground">{lastPushError}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setLastPushError(null)}>Dismiss</Button>
              </div>
            </div>
          )}

          {/* Escalation banner (non-blocking) */}
          {escalationBannerOpen && pendingSubmission && (
            <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200 flex items-start justify-between gap-4">
              <div className="text-sm">
                <div className="font-semibold">Escalation suggested</div>
                <div className="text-xs text-muted-foreground">
                  This report appears to involve a serious concern. You can provide more details for escalation, or submit anonymously.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEscalationOpen(true); setEscalationBannerOpen(false); }}>Provide details</Button>
                <Button size="sm" onClick={() => { submitAnonymouslyFromEscalation(); setEscalationBannerOpen(false); }}>Submit anonymously</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEscalationBannerOpen(false); setPendingSubmission(null); toast.info('You can still edit your report and submit later.'); }}>Dismiss</Button>
              </div>
            </div>
          )}

          {/* Pending offline reports info */}
          {pendingCount > 0 && (
            <div className="p-3 rounded-md bg-primary/5 border border-primary/20 flex items-start justify-between gap-4">
              <div className="text-sm">
                <div className="font-semibold">Saved reports waiting to be sent</div>
                <div className="text-xs text-muted-foreground">We saved {pendingCount} report(s) locally and will try to send them when possible.</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={retryPendingWrites}>Retry pending writes</Button>
              </div>
            </div>
          )}
          {/* Header Section */}
          <div className="text-center space-y-4 animate-fade-in">
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-primary-glow to-secondary bg-clip-text text-transparent transition-all duration-500 hover:scale-105">
              Submit a Confidential Report
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto transition-all duration-300 leading-relaxed">
              Your safety is our priority. All reports are handled with care and confidentiality.
            </p>
          </div>

          {/* Mode Switch Tabs: Voice Phone Booth (Primary) vs. Manual Typing Form (Secondary) */}
          <div className="flex items-center justify-center gap-3 p-1.5 rounded-2xl bg-muted/60 border max-w-md mx-auto shadow-sm">
            <button
              type="button"
              onClick={() => setReportingMode('booth')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                reportingMode === 'booth'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Phone className="w-4 h-4" />
              Voice Phone Booth (Primary)
            </button>
            <button
              type="button"
              onClick={() => setReportingMode('manual')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                reportingMode === 'manual'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Manual Form (Secondary)
            </button>
          </div>

          {reportingMode === 'booth' ? (
            <PhoneBooth
              onSwitchToTyping={handleSwitchToTyping}
              onReportSubmitted={(reportId) => {
                toast.success(`Voice Report ${reportId} submitted successfully!`);
              }}
            />
          ) : (
            <>

          {/* Anonymous Toggle Card - Hidden if teacher/staff involved (mandatory named report) */}
          {!(liveKeyword?.patternId === 'teacher_involved' && form.getValues('personType') !== 'student') && (
            <Card className="border-primary/20 shadow-lg animate-fade-in transition-all duration-300 hover:shadow-xl hover:scale-[1.01] hover:border-primary/40">
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-primary/10 transition-all duration-300 hover:bg-primary/20">
                      {isAnonymous ? (
                        <UserX className="h-6 w-6 text-primary transition-all duration-300" />
                      ) : (
                        <User className="h-6 w-6 text-primary transition-all duration-300" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg transition-all duration-300">
                        {isAnonymous ? 'Anonymous Report' : 'Named Report'}
                      </h3>
                      <p className="text-sm text-muted-foreground transition-all duration-300">
                        You can stay completely private if you want - it's up to you!
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={!isAnonymous}
                    disabled={isSubmitting}
                    onCheckedChange={(checked) => {
                      setIsAnonymous(!checked);
                      form.setValue('isAnonymous', !checked);
                    }}
                    className="transition-all duration-300"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Teacher/Staff Mandatory Name Notice */}
          {(liveKeyword?.patternId === 'teacher_involved' && form.getValues('personType') !== 'student') && (
            <Card className="border-yellow-400 bg-yellow-50/50 shadow-lg animate-fade-in">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-lg bg-yellow-100">
                  <User className="h-6 w-6 text-yellow-700" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-yellow-900">
                    Named Report Required
                  </h3>
                  <p className="text-sm text-yellow-800">
                    For reports involving teachers or staff, school policy requires your name and class. This ensures we can investigate properly.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              {/* Category Selection */}
              <div className="space-y-4 animate-fade-in">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-2xl font-semibold">
                        What do you want to tell us about? <span className="text-destructive">*</span>
                      </FormLabel>
                      <p className="text-muted-foreground mb-4">Pick the one that fits best</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {categories.map((cat, index) => {
                          const Icon = cat.icon;
                          const isSelected = field.value === cat.value;
                          return (
                            <Card
                              key={cat.value}
                              className={`cursor-pointer transition-all duration-300 hover:shadow-xl hover:scale-[1.03] active:scale-[0.98] ${isSelected
                                ? 'border-primary bg-primary/10 shadow-lg scale-[1.02] ring-2 ring-primary/20'
                                : 'border-border bg-card hover:border-primary/50 hover:bg-primary/5'
                                } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => !isSubmitting && field.onChange(cat.value)}
                              style={{ animationDelay: `${index * 50}ms` }}
                            >
                              <CardContent className="p-6 flex items-center gap-4">
                                <div className={`p-3 rounded-lg transition-all duration-300 ${isSelected ? 'bg-primary/20 scale-110 shadow-md' : 'bg-muted group-hover:scale-105'
                                  }`}>
                                  <Icon className={`h-6 w-6 transition-all duration-300 ${isSelected ? 'text-primary' : 'text-muted-foreground'
                                    }`} />
                                </div>
                                <span className={`font-medium transition-all duration-300 ${isSelected ? 'text-primary' : ''}`}>
                                  {cat.label}
                                </span>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Intensity Level Selection */}
              <div className="space-y-4 animate-fade-in">
                <FormField
                  control={form.control}
                  name="intensity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-2xl font-semibold">
                        How serious is this? <span className="text-destructive">*</span>
                      </FormLabel>
                      <p className="text-muted-foreground mb-4">Help us understand the urgency</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {intensityLevels.map((level, index) => {
                          const isSelected = field.value === level.value;
                          return (
                            <Card
                              key={level.value}
                              className={`cursor-pointer transition-all duration-300 hover:shadow-xl hover:scale-110 active:scale-95 ${isSelected
                                ? `${level.color} shadow-lg border-2 scale-105 ring-2 ring-offset-2`
                                : 'border-border bg-card hover:border-primary/30'
                                } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => !isSubmitting && field.onChange(level.value)}
                              style={{ animationDelay: `${index * 75}ms` }}
                            >
                              <CardContent className="p-4 text-center transition-all duration-300">
                                <div className={`font-semibold text-base mb-1 transition-all duration-300 ${isSelected ? 'scale-110' : ''}`}>
                                  {level.label}
                                </div>
                                <div className="text-xs opacity-80">{level.description}</div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Description */}
              <Card className="border-primary/20 shadow-lg animate-fade-in transition-all duration-300 hover:shadow-xl">
                <CardContent className="p-6 space-y-6">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xl font-semibold">
                          Tell us what happened <span className="text-destructive">*</span>
                        </FormLabel>

                        {/* Input Mode Toggle */}
                        <div className="flex gap-2 mb-4">
                          <Button
                            type="button"
                            variant={inputMode === 'text' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setInputMode('text')}
                            className="flex-1 transition-all duration-300 hover:scale-105 hover:shadow-md"
                            disabled={isSubmitting}
                          >
                            Text Input
                          </Button>
                          <Button
                            type="button"
                            variant={inputMode === 'voice' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setInputMode('voice')}
                            className="flex-1 transition-all duration-300 hover:scale-105 hover:shadow-md"
                            disabled={isSubmitting}
                          >
                            <Mic className="mr-2 h-4 w-4" />
                            Voice Input
                          </Button>
                        </div>

                        <FormControl>
                          <div className="space-y-3">
                            {inputMode === 'text' ? (
                              <Textarea
                                placeholder="Please describe your concern in detail... We're here to listen and help."
                                className="min-h-40 resize-none transition-all duration-300 focus:scale-[1.01] focus:shadow-lg"
                                disabled={isSubmitting}
                                {...field}
                              />
                            ) : (
                              <div className="space-y-3 animate-fade-in">
                                <div className="relative">
                                  <Textarea
                                    placeholder="Your spoken words will appear here..."
                                    className="min-h-40 resize-none bg-primary/5 transition-all duration-300 focus:shadow-lg"
                                    {...field}
                                    readOnly
                                  />
                                  {isRecording && (
                                    <div className="absolute top-3 right-3 flex items-center gap-2 bg-red-500 text-white px-3 py-2 rounded-full text-sm font-semibold shadow-lg">
                                      <div className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                                      </div>
                                      Recording
                                    </div>
                                  )}
                                  {field.value && field.value.length > 0 && (
                                    <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded backdrop-blur-sm">
                                      {field.value.split(' ').filter(w => w).length} words
                                    </div>
                                  )}
                                </div>
                                {isRecording && recognition?.isSupported && (
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={stopRecording}
                                    className="w-full transition-all duration-300 hover:scale-105 hover:shadow-lg animate-fade-in"
                                  >
                                    <div className="flex items-center justify-center gap-2">
                                      <div className="h-3 w-3 bg-white rounded-sm"></div>
                                      Stop Recording
                                    </div>
                                  </Button>
                                )}

                                {/* Fallback recorder for environments without SpeechRecognition */}
                                {!recognition?.isSupported && (
                                  <div className="space-y-3">
                                    <RecordFallback />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </FormControl>

                        <FormDescription className="transition-all duration-300">
                          {inputMode === 'voice'
                            ? isRecording
                              ? "🎤 Listening continuously... Your words appear above as you speak."
                              : "⏳ Preparing microphone..."
                            : "💬 Type your message here, or switch to Voice mode to speak instead."}
                        </FormDescription>

                        {/* AI Engine & Ollama Controls */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-muted/40 rounded-lg border border-border/60 mt-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <div className="flex items-center gap-1.5 font-semibold text-sm">
                              <Bot className="h-4 w-4 text-primary" />
                              <span>AI Classifier:</span>
                            </div>
                            {ollamaStatus?.available ? (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 flex items-center gap-1.5 text-xs py-0.5">
                                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                Ollama ({ollamaStatus.selectedModel})
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground flex items-center gap-1.5 text-xs py-0.5">
                                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                                Ollama Offline (Using Rule AI)
                              </Badge>
                            )}

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setCustomHostInput(getCustomOllamaHost() || '');
                                setTestHostFeedback(null);
                                setAiSettingsOpen(true);
                              }}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                              title="Configure Laptop / Remote AI Host"
                            >
                              <Settings className="h-3.5 w-3.5" />
                            </Button>
                            <div className="flex items-center gap-2 border-l pl-2.5 ml-1">
                              <Switch
                                id="demo-ai-toggle"
                                checked={demoAiEnabled}
                                onCheckedChange={(checked) => {
                                  setDemoAiEnabled(checked);
                                  try { localStorage.setItem('demoAi', checked ? '1' : '0'); } catch (e) { }
                                }}
                              />
                              <label htmlFor="demo-ai-toggle" className="text-xs text-muted-foreground cursor-pointer">
                                Force Local Engine
                              </label>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={testAiNow}
                              disabled={isLiveAiLoading || !descriptionValue || descriptionValue.trim().length < 10}
                              className="text-xs"
                            >
                              {isLiveAiLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1 text-primary" />}
                              Analyze with AI
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={selfTestNow}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Run Self-Test
                            </Button>
                          </div>
                        </div>

                        {/* Live AI Risk Assessment Display */}
                        {(isLiveAiLoading || liveAiAnalysis) && (
                          <div className="p-4 rounded-lg border bg-card/80 shadow-sm space-y-2.5 animate-fade-in mt-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">Live AI Risk Assessment:</span>
                                {isLiveAiLoading ? (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                    <span>Analyzing report text...</span>
                                  </div>
                                ) : (
                                  <Badge
                                    className={
                                      liveAiAnalysis.risk_level === 'L3'
                                        ? 'bg-red-600 text-white hover:bg-red-700'
                                        : liveAiAnalysis.risk_level === 'L2'
                                          ? 'bg-orange-500 text-white hover:bg-orange-600'
                                          : liveAiAnalysis.risk_level === 'L1'
                                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    }
                                  >
                                    Level {liveAiAnalysis.risk_level}
                                  </Badge>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                {liveAiAnalysis?.details?.source === 'ollama' && (
                                  <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200">
                                    Ollama LLM ({liveAiAnalysis.details.model})
                                  </Badge>
                                )}
                                {liveAiAnalysis?.category && (
                                  <span className="text-xs font-medium text-muted-foreground capitalize">
                                    Category: {liveAiAnalysis.category.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </div>
                            </div>

                            {liveAiAnalysis && (
                              <>
                                <div className="text-sm font-medium text-foreground">
                                  {mapRiskLabel(liveAiAnalysis.risk_level)}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {liveAiAnalysis.details?.explanation || mapRiskAction(liveAiAnalysis.risk_level)}
                                </p>
                                {liveAiAnalysis.details?.suggested_action && (
                                  <div className="text-xs bg-muted/60 p-2 rounded border border-border/60 text-muted-foreground">
                                    <strong className="text-foreground">Suggested Action:</strong> {liveAiAnalysis.details.suggested_action}
                                  </div>
                                )}

                                {/* Emotion Tags detected from speech / text */}
                                {liveAiAnalysis.details?.detected_feelings && liveAiAnalysis.details.detected_feelings.length > 0 && (
                                  <div className="flex items-center gap-2 pt-2 border-t border-border/40 flex-wrap">
                                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                                      <Heart className="h-3.5 w-3.5 text-pink-500 fill-pink-500" /> Feelings Heard:
                                    </span>
                                    {liveAiAnalysis.details.detected_feelings.map((feeling: string, i: number) => (
                                      <Badge key={i} variant="secondary" className="text-xs bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20">
                                        {feeling}
                                      </Badge>
                                    ))}
                                  </div>
                                )}

                                {/* AI Empathy & Comfort Voice Box */}
                                {liveAiAnalysis.details?.supportive_message && (
                                  <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-2 mt-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                                        <Heart className="h-3.5 w-3.5 text-primary fill-primary" />
                                        SafeSpeak AI Voice Companion
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => speakSupportMessage(liveAiAnalysis.details.supportive_message)}
                                        className="h-7 px-2 text-xs text-primary hover:bg-primary/10 gap-1"
                                        title="Hear reassurance aloud"
                                      >
                                        {isSpeaking ? <VolumeX className="h-3.5 w-3.5 text-destructive" /> : <Volume2 className="h-3.5 w-3.5" />}
                                        <span>{isSpeaking ? 'Stop Voice' : 'Listen to Voice'}</span>
                                      </Button>
                                    </div>
                                    <p className="text-xs text-foreground/90 italic leading-relaxed">
                                      "{liveAiAnalysis.details.supportive_message}"
                                    </p>
                                  </div>
                                )}

                                {/* One-click Auto-Fill from Spoken Details */}
                                <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/40">
                                  <span className="text-xs text-muted-foreground">
                                    Detected Category: <strong className="text-foreground capitalize">{liveAiAnalysis.category?.replace(/_/g, ' ') || 'General'}</strong>
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={applyAiSuggestionsToForm}
                                    className="h-7 text-xs border-primary/30 hover:bg-primary/10 text-primary gap-1"
                                  >
                                    <CheckCheck className="h-3.5 w-3.5" />
                                    Auto-Fill Form from What You Said
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Person Type Selection - Always Visible */}
                        <FormField
                          control={form.control}
                          name="personType"
                          render={({ field }) => (
                            <FormItem className="mt-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                              <FormLabel className="text-base font-semibold">
                                Who is the person involved? <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormDescription className="text-xs mb-3">
                                Specify if this involves a student, teacher, or staff member.
                              </FormDescription>
                              <FormControl>
                                <div className="flex flex-wrap gap-4">
                                  {['student', 'teacher', 'staff'].map((type) => (
                                    <label key={type} className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-md border transition-all duration-200 ${field.value === type ? 'bg-primary/10 border-primary shadow-sm' : 'bg-background border-input hover:bg-muted'}`}>
                                      <input
                                        type="radio"
                                        value={type}
                                        checked={field.value === type}
                                        onChange={() => field.onChange(type)}
                                        className="w-4 h-4 accent-primary"
                                      />
                                      <span className="capitalize font-medium">{type}</span>
                                    </label>
                                  ))}
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Live detection banner: keyword highlights */}
                        {/* Only show if keywords matches AND AI hasn't ruled it out as harmless (L0) */}
                        {liveKeyword?.matched && (!liveAiAnalysis || liveAiAnalysis.risk_level !== 'L0') && (
                          <div className={`p-3 rounded-md border ${liveKeyword.patternId === 'teacher_involved' ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800'} mt-3`}>
                            <div className="font-semibold flex items-center gap-2 text-yellow-900 dark:text-yellow-200">
                              <AlertTriangle className="h-4 w-4 text-yellow-600" />
                              {liveKeyword.patternId === 'teacher_involved' ? 'Teacher/Staff reference detected' : `Detected: ${liveKeyword.reason}`}
                            </div>
                            <div className="text-sm text-yellow-800 dark:text-yellow-300 mt-1">
                              {liveKeyword.patternId === 'teacher_involved'
                                ? 'We noticed words referencing a teacher or staff member. To help us follow up, please include your name, class, and school; this will allow proper support.'
                                : `We noticed sensitive language indicating ${liveKeyword.reason?.toLowerCase()}. Our team will prioritize this report.`}
                            </div>
                            {liveAiAnalysis && (
                              <div className="mt-2 text-xs font-medium text-blue-600 flex items-center gap-1">
                                <span>✓ AI Verification: {liveAiAnalysis.risk_level === 'L3' ? 'Confirmed Serious' : 'Analyzing context...'}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Teacher/Staff Information Box - Only shows required Name field now */}
                        {(form.watch('personType') === 'teacher' || form.watch('personType') === 'staff') && (
                          <div className="mt-4 p-4 rounded-lg border-2 border-yellow-300 bg-yellow-50/50 space-y-4 animate-fade-in">
                            <div className="space-y-1">
                              <h4 className="font-semibold text-base">Required Information</h4>
                              <p className="text-sm text-muted-foreground">
                                Because this involves a teacher or staff member, we need your details to follow up properly.
                              </p>
                              <p className="text-sm mt-1"><strong>🔒 This data is encrypted and sent ONLY to the CCPRB (Central Child Protection Response Board).</strong> The school will NOT see this report initially.</p>
                            </div>

                            <div className="space-y-3">
                              {/* Name of the person involved (teacher/staff) - required */}
                              <FormField
                                control={form.control}
                                name="implicatedName"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-sm font-medium">
                                      Name of person involved (Teacher/Staff) <span className="text-destructive">*</span>
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder="e.g., Mr. Kumar"
                                        className="bg-white"
                                        disabled={isSubmitting}
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              {/* Reporter Name field (required for Teacher/Staff) */}
                              <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-sm font-medium">
                                      Your Full Name <span className="text-destructive">*</span>
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder="Enter your full name"
                                        className="bg-white"
                                        disabled={isSubmitting}
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                            </div>
                          </div>
                        )}

                        {/* Live AI status - simple, clean message */}
                        {liveKeyword?.patternId === 'teacher_involved' && (
                          <div className="mt-3 text-sm text-muted-foreground">
                            ✓ AI detected teacher/staff involvement
                          </div>
                        )}


                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Age Input */}
                  <FormField
                    control={form.control}
                    name="age"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xl font-semibold">How old are you?</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="5"
                            max="99"
                            placeholder="Enter your age"
                            className="max-w-xs transition-all duration-300 focus:scale-[1.02] focus:shadow-lg"
                            disabled={isSubmitting}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Class Input (Replaces School Input) */}
                  <FormField
                    control={form.control}
                    name="classroom"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xl font-semibold">
                          Class / Grade {liveKeyword?.patternId === 'teacher_involved' && form.getValues('personType') !== 'student' && <span className="text-destructive">*</span>}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., 8A, Grade 9"
                            className="transition-all duration-300 focus:scale-[1.01] focus:shadow-lg"
                            disabled={isSubmitting}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* If category is bullying, ask for the name of the person bullying (if not teacher/staff) */}
                  {category === 'bullying' && form.watch('personType') !== 'teacher' && form.watch('personType') !== 'staff' && (
                    <FormField
                      control={form.control}
                      name="bullyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xl font-semibold">Name of person bullying <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., John Doe"
                              className="transition-all duration-300 focus:scale-[1.01] focus:shadow-lg"
                              disabled={isSubmitting}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Contact Info for Named Reports OR Teacher/Staff Reports */}
                  {(!isAnonymous || liveKeyword?.patternId === 'teacher_involved') && (
                    <div className="space-y-4 p-6 bg-primary/5 rounded-lg border border-primary/20 animate-fade-in transition-all duration-300">
                      <h3 className="font-semibold text-lg">
                        {liveKeyword?.patternId === 'teacher_involved'
                          ? 'Required Information (Teacher/Staff Involved)'
                          : 'Contact Information'}
                      </h3>
                      {liveKeyword?.patternId === 'teacher_involved' && (
                        <p className="text-sm text-muted-foreground">
                          Because this involves a teacher or staff member, we need your details to follow up properly.
                        </p>
                      )}
                      {/* Name Field - Show ONLY if we are NOT in Teacher/Staff Mode (because Teacher Mode has its own name field above) */}
                      {!(form.watch('personType') === 'teacher' || form.watch('personType') === 'staff') && (
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Your Full Name <span className="text-destructive">*</span></FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Enter your name"
                                  className="transition-all duration-300 focus:scale-[1.01] focus:shadow-lg"
                                  disabled={isSubmitting}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={form.control}
                        name="contact"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact Information</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Email or phone number"
                                className="transition-all duration-300 focus:scale-[1.01] focus:shadow-lg"
                                disabled={isSubmitting}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Info Cards */}
              <div className="grid md:grid-cols-2 gap-4 animate-fadeIn">
                <div className="flex items-start gap-3 p-5 bg-primary/5 rounded-xl border border-primary/20 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] hover:border-primary/40 cursor-default">
                  <Shield className="h-6 w-6 text-primary mt-0.5 flex-shrink-0 transition-all duration-300" />
                  <div className="text-sm">
                    <p className="font-semibold mb-1 text-base">Your Security Matters</p>
                    <p className="text-muted-foreground">
                      All reports are encrypted with 256-bit encryption and stored securely.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-5 bg-destructive/5 rounded-xl border border-destructive/20 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] hover:border-destructive/40 cursor-default">
                  <Phone className="h-6 w-6 text-destructive mt-0.5 flex-shrink-0 transition-all duration-300" />
                  <div className="text-sm">
                    <p className="font-semibold mb-1 text-base">Emergency? Call Now</p>
                    <p className="text-muted-foreground">
                      Childline: <strong>1098</strong> | Emergency: <strong>112</strong>
                    </p>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full text-lg py-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] animate-fade-in relative overflow-hidden group"
                size="lg"
                disabled={isSubmitting}
                onClick={(e) => {
                  // If standard validation passes but we have custom logic or event issues, stop propagation
                  // But handleSubmit normally handles this. We add this just in case of weird browser behaviors.
                  // e.stopPropagation(); 
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-primary-glow/0 via-primary-glow/20 to-primary-glow/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    <span className="relative">Submitting Report...</span>
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-5 w-5 relative" />
                    <span className="relative">Submit Report Safely</span>
                  </>
                )}
              </Button>
            </form>
          </Form>
          </>
          )}

          {/* Escalation confirmation dialog: require identity when threats are detected */}
          <Dialog open={escalationOpen} onOpenChange={(open) => { if (!open) cancelEscalation(); setEscalationOpen(open); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-lg">Important: Escalation Required</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {pendingSubmission?.keywordCheck?.patternId === 'teacher_involved'
                    ? 'We detected language that references a teacher or staff member. To escalate responsibly, please provide your name, class, and school so the appropriate agency can follow up.'
                    : 'This report appears to involve a serious safety concern and will be escalated to higher authorities. To proceed with escalation, we need basic contact details (your name and school) so that the appropriate agency can follow up.'}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                {pendingSubmission?.aiAnalysis && (
                  <div className="p-3 rounded-md bg-destructive/5 border border-destructive/20">
                    <div className="font-semibold">Detection: {pendingSubmission?.aiAnalysis?.risk_level || 'Unknown'}</div>
                    <div className="text-sm text-muted-foreground">We classified this as: {pendingSubmission?.aiAnalysis?.category || pendingSubmission?.aiAnalysis?.route_to || '—'}</div>
                  </div>
                )}
                {pendingSubmission?.keywordCheck?.matched && (
                  <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200">
                    <div className="font-semibold">Keyword match: {pendingSubmission.keywordCheck.reason}</div>
                    <div className="text-sm text-muted-foreground">We detected phrases that may indicate immediate risk.</div>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Your Full Name (required for escalation)</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="classroom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Class / Section (required for escalation)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 8A, Grade 9" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {pendingSubmission?.keywordCheck?.patternId === 'teacher_involved' && (
                  <>
                    <div className="p-4 mb-3 rounded-md bg-blue-50 border border-blue-100">
                      <h4 className="font-semibold">Your Safety is Our Priority</h4>
                      <p className="text-sm text-muted-foreground mt-1">Because a teacher or staff member is involved, we need your details to take official action.</p>
                      <p className="text-sm mt-2"><strong>🔒 This data is encrypted and sent ONLY to the CCPRB (Central Child Protection Response Board).</strong> The school will NOT see this report initially.</p>
                    </div>

                    <FormField
                      control={form.control}
                      name="implicatedName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Teacher / Staff Name (required for escalation)</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter name of the teacher or staff member" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {pendingSubmission?.values?.category === 'bullying' && (
                  <FormField
                    control={form.control}
                    name="bullyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Name of person bullying (required for escalation)</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter name of person bullying" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}



              </div>

              <DialogFooter className="mt-4">
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={cancelEscalation}>Cancel</Button>
                  <Button type="button" variant="ghost" onClick={submitAnonymouslyFromEscalation}>Submit anonymously</Button>
                  <Button type="button" onClick={confirmEscalation}>Provide Details & Submit</Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Remote / Laptop AI Server Settings Modal */}
          <Dialog open={aiSettingsOpen} onOpenChange={setAiSettingsOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-primary" />
                  Laptop / Remote AI Server Settings
                </DialogTitle>
                <DialogDescription>
                  Running Ollama on your laptop? Enter your laptop's local network IP or hostname below so this station can use it for real-time safety classification and emotional support.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">
                    Ollama Host URL
                  </label>
                  <Input
                    placeholder="e.g. http://192.168.1.15:11434 or http://laptop.local:11434"
                    value={customHostInput}
                    onChange={(e) => {
                      setCustomHostInput(e.target.value);
                      setTestHostFeedback(null);
                    }}
                    className="font-mono text-xs"
                  />
                  <div className="flex gap-2 pt-1 flex-wrap">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCustomHostInput('http://127.0.0.1:11434');
                        setTestHostFeedback(null);
                      }}
                      className="text-[11px] h-6 px-2"
                    >
                      Localhost (127.0.0.1)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCustomHostInput('/api/ollama');
                        setTestHostFeedback(null);
                      }}
                      className="text-[11px] h-6 px-2"
                    >
                      Vite Proxy (/api/ollama)
                    </Button>
                  </div>
                </div>

                {testHostFeedback && (
                  <div className={`p-2.5 rounded text-xs border ${testHostFeedback.success ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-300' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                    {testHostFeedback.message}
                  </div>
                )}

                <div className="text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded space-y-1">
                  <div className="font-semibold text-foreground">How to allow the Pi to connect from your Laptop:</div>
                  <div>1. On your laptop, run: <code>ollama serve</code> with <code>OLLAMA_HOST=0.0.0.0:11434</code></div>
                  <div>2. Make sure laptop and Raspberry Pi are on the same Wi-Fi.</div>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isTestingHost}
                  onClick={handleTestHost}
                  className="text-xs"
                >
                  {isTestingHost ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wifi className="h-3 w-3 mr-1" />}
                  Test Connection
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveHost}
                  className="text-xs"
                >
                  Save & Connect
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </div>
      </main >
      <Footer />
    </div >
  );
};

export default Report;
