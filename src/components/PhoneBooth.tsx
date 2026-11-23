import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Phone,
  PhoneOff,
  PhoneCall,
  PhoneIncoming,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  Heart,
  Shield,
  AlertTriangle,
  Settings,
  Wifi,
  WifiOff,
  CheckCircle2,
  ArrowRight,
  Keyboard,
  RefreshCw,
  Sun,
  Eye,
  Type
} from 'lucide-react';
import { phoneBoothManager, PhoneBoothTurn, ExtractedReportSlots, getSavedPhoneBoothWsUrl, savePhoneBoothWsUrl } from '@/lib/phoneBoothService';
import { toast } from 'sonner';

interface PhoneBoothProps {
  onSwitchToTyping?: (extractedSlots?: ExtractedReportSlots) => void;
  onReportSubmitted?: (reportId: string) => void;
}

export const PhoneBooth: React.FC<PhoneBoothProps> = ({ onSwitchToTyping, onReportSubmitted }) => {
  // Call & Connection State
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'active' | 'completed'>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState('Listening');
  const [inquiryState, setInquiryState] = useState('idle');
  const [turns, setTurns] = useState<PhoneBoothTurn[]>([]);
  const [extractedSlots, setExtractedSlots] = useState<ExtractedReportSlots>({});
  const [callDuration, setCallDuration] = useState(0);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);

  // Accessibility State
  const [textSize, setTextSize] = useState<'normal' | 'large' | 'xlarge'>('normal');
  const [highContrast, setHighContrast] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);

  // Settings & Network
  const [serverUrl, setServerUrl] = useState(getSavedPhoneBoothWsUrl());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempWsUrl, setTempWsUrl] = useState(serverUrl);
  const [recognition, setRecognition] = useState<any>(null);

  const turnsEndRef = useRef<HTMLDivElement | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, isAgentSpeaking]);

  // Duration Timer
  useEffect(() => {
    if (callState === 'active') {
      setCallDuration(0);
      durationTimerRef.current = window.setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [callState]);

  // Auto-return to Idle on completion
  useEffect(() => {
    if (callState === 'completed') {
      setIdleCountdown(12);
      countdownTimerRef.current = window.setInterval(() => {
        setIdleCountdown((prev) => {
          if (prev !== null && prev <= 1) {
            clearInterval(countdownTimerRef.current as number);
            setCallState('idle');
            setSubmittedReportId(null);
            setTurns([]);
            setExtractedSlots({});
            return null;
          }
          return prev !== null ? prev - 1 : null;
        });
      }, 1000);
    } else {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setIdleCountdown(null);
    }
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [callState]);

  // Subscribe to Phone Booth Session updates
  useEffect(() => {
    const unsubscribe = phoneBoothManager.subscribe((state) => {
      if (state.isConnected !== undefined) setIsConnected(state.isConnected);
      if (state.isAgentSpeaking !== undefined) setIsAgentSpeaking(state.isAgentSpeaking);
      if (state.currentEmotion) setCurrentEmotion(state.currentEmotion);
      if (state.inquiryState) setInquiryState(state.inquiryState);
      if (state.extractedSlots) setExtractedSlots(prev => ({ ...prev, ...state.extractedSlots }));
      if (state.turns) setTurns(state.turns);
      if (state.error) toast.error(state.error);
    });

    return () => unsubscribe();
  }, []);

  // Web Speech Recognition for Student Audio Input
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onresult = (event: any) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const spoken = lastResult[0].transcript.trim();
          if (spoken.length > 0) {
            console.log('🎤 Student said:', spoken);
            setTurns(prev => [
              ...prev,
              { turn: prev.length + 1, speaker: 'student', text: spoken, timestamp: Date.now() }
            ]);
            phoneBoothManager.sendStudentSpeech(spoken);
          }
        }
      };

      rec.onerror = (e: any) => {
        if (e.error !== 'no-speech') {
          console.warn('Speech recognition error:', e.error);
        }
      };

      rec.onend = () => {
        if (callState === 'active') {
          try { rec.start(); } catch {}
        }
      };

      setRecognition(rec);
    }
  }, [callState]);

  // Start Call Handler
  const handlePickUp = async () => {
    setCallState('connecting');
    setSubmittedReportId(null);
    setTurns([]);
    setExtractedSlots({});

    toast.info('Connecting to SafeSpeak AI Assistant...', { duration: 2500 });
    const success = await phoneBoothManager.startCall(serverUrl);

    if (success) {
      setCallState('active');
      setIsListening(true);
      if (recognition) {
        try { recognition.start(); } catch {}
      }
      toast.success('Connected. The AI is listening.', { duration: 3000 });
    } else {
      setCallState('active'); // Still enter active mode in local failure-safe fallback!
      setIsListening(true);
      if (recognition) {
        try { recognition.start(); } catch {}
      }
      toast.warning('Running in Offline Mode. Your voice will be recorded for counselors.', { duration: 5000 });
    }
  };

  // Hang Up Call Handler
  const handleHangUp = async () => {
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    setIsListening(false);
    phoneBoothManager.stopSpeaking();

    toast.info('Submitting your encrypted report to school counselors...', { duration: 3000 });
    const res = await phoneBoothManager.endCall(extractedSlots);

    setCallState('completed');
    if (res.reportId) {
      setSubmittedReportId(res.reportId);
      toast.success(`Voice Report ${res.reportId} submitted successfully!`, { duration: 6000 });
      if (onReportSubmitted) onReportSubmitted(res.reportId);
    }
  };

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Dynamic Typography based on accessibility text size
  const transcriptTextClass =
    textSize === 'xlarge' ? 'text-lg leading-relaxed' :
    textSize === 'large' ? 'text-base leading-normal' :
    'text-sm';

  return (
    <div className={`w-full max-w-4xl mx-auto transition-colors duration-300 ${highContrast ? 'contrast-125' : ''}`}>
      {/* Phone Booth Enclosure */}
      <Card className={`border-2 shadow-2xl overflow-hidden relative backdrop-blur-md transition-all duration-300 ${
        highContrast
          ? 'bg-black text-white border-amber-400'
          : 'border-emerald-500/25 bg-gradient-to-b from-card/95 via-card/90 to-background/95'
      }`}>
        
        {/* Top Kiosk Header Bar */}
        <div className={`px-6 py-3 border-b flex items-center justify-between transition-colors ${
          highContrast ? 'bg-amber-400/20 border-amber-400' : 'bg-emerald-500/10 border-emerald-500/20'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full transition-all duration-300 ${
              callState === 'active'
                ? 'bg-emerald-500 text-white animate-pulse shadow-lg shadow-emerald-500/30'
                : 'bg-muted text-muted-foreground'
            }`}>
              {callState === 'active' ? <PhoneCall className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base md:text-lg tracking-tight">SafeSpeak Voice Booth</h3>
                <Badge
                  variant={isConnected ? "default" : "outline"}
                  className={`text-xs ${isConnected ? "bg-emerald-600 hover:bg-emerald-600 text-white" : "border-yellow-500/40 text-yellow-600"}`}
                >
                  {isConnected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
                  {isConnected ? "AI Assistant Ready" : "Offline Fallback Ready"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Automated AI support • Direct review by trained school counselors • No forced details
              </p>
            </div>
          </div>

          {/* Accessibility & Settings Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {callState === 'active' && (
              <Badge variant="secondary" className="font-mono text-sm px-3 py-1 bg-background/80 border">
                ⏱️ {formatTimer(callDuration)}
              </Badge>
            )}

            {/* Text Size Accessibility Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTextSize(prev => prev === 'normal' ? 'large' : prev === 'large' ? 'xlarge' : 'normal');
              }}
              className="h-8 px-2 text-xs gap-1"
              title="Toggle Large Text Size"
            >
              <Type className="w-3.5 h-3.5" />
              <span className="hidden sm:inline uppercase text-[10px] font-bold">{textSize}</span>
            </Button>

            {/* High Contrast Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHighContrast(!highContrast)}
              className={`h-8 w-8 ${highContrast ? 'text-amber-400' : 'text-muted-foreground'}`}
              title="Toggle High Contrast Mode"
            >
              <Eye className="w-4 h-4" />
            </Button>

            {/* Settings Dialog Trigger */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Secondary Laptop Server Settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <CardContent className="p-6 space-y-6">
          {/* ========================================================================= */}
          {/* SCREEN 1: IDLE / ATTRACT SCREEN                                           */}
          {/* ========================================================================= */}
          {callState === 'idle' && (
            <div className="py-12 px-6 flex flex-col items-center justify-center text-center space-y-6 animate-fade-in">
              {/* Pulsing Breathing Light Ring */}
              <div className="relative flex items-center justify-center">
                <div className="absolute w-44 h-44 rounded-full bg-emerald-500/10 animate-ping pointer-events-none" />
                <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border-2 border-emerald-500/30 flex items-center justify-center shadow-2xl">
                  <Phone className="w-14 h-14 text-emerald-600 dark:text-emerald-400 transition-transform duration-300 hover:scale-110" />
                </div>
              </div>

              {/* Welcoming Title */}
              <div className="space-y-2 max-w-lg">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  You Don&apos;t Have to Carry This Alone
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  Pick up the phone to talk directly with <strong>SafeSpeak AI</strong>.
                  Speak freely in your own words. Names and details are completely optional, and your report is reviewed by caring school counselors.
                </p>
              </div>

              {/* Big Physical/Touch Button */}
              <div className="pt-2">
                <Button
                  size="lg"
                  onClick={handlePickUp}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-600/30 px-10 py-7 text-xl font-bold rounded-full gap-3 transition-transform hover:scale-105 active:scale-95"
                >
                  <Phone className="w-7 h-7" />
                  Pick Up Phone (Start Call)
                </Button>
              </div>

              {/* Safe Safeguarding Reassurance Tags */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1 bg-muted/60 px-3 py-1 rounded-full border">
                  <Shield className="w-3.5 h-3.5 text-emerald-500" />
                  Encrypted & Safe
                </span>
                <span className="flex items-center gap-1 bg-muted/60 px-3 py-1 rounded-full border">
                  <Heart className="w-3.5 h-3.5 text-rose-500" />
                  Supportive & Gentle
                </span>
                <span className="flex items-center gap-1 bg-muted/60 px-3 py-1 rounded-full border">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  No Typing Required
                </span>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 2: CONNECTING / LIFTED RECEIVER STATE                              */}
          {/* ========================================================================= */}
          {callState === 'connecting' && (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 animate-fade-in">
              <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center animate-bounce">
                <PhoneIncoming className="w-10 h-10 text-emerald-600" />
              </div>
              <h4 className="text-xl font-bold">Lifting Receiver & Connecting...</h4>
              <p className="text-sm text-muted-foreground max-w-sm">
                SafeSpeak AI is connecting to the dedicated companion server. Take a deep breath.
              </p>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 3: ACTIVE CALL INTERFACE                                           */}
          {/* ========================================================================= */}
          {callState === 'active' && (
            <div className="space-y-6 animate-fade-in">
              {/* Call Visualizer Header */}
              <div className="p-6 rounded-2xl bg-gradient-to-b from-muted/40 to-muted/10 border flex flex-col items-center justify-center text-center relative overflow-hidden">
                {/* Handset Icon + Soundwave Ripple */}
                <div className="relative mb-3">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${
                    isAgentSpeaking
                      ? 'bg-blue-600 text-white shadow-blue-500/30 ring-8 ring-blue-500/20'
                      : 'bg-emerald-600 text-white shadow-emerald-500/30 ring-8 ring-emerald-500/20 animate-pulse'
                  }`}>
                    {isAgentSpeaking ? <Volume2 className="w-10 h-10 animate-pulse" /> : <Mic className="w-10 h-10" />}
                  </div>
                </div>

                {/* Animated Soundwave Visualizer Bars */}
                <div className="flex items-center gap-1.5 h-8 my-2">
                  {[40, 70, 100, 60, 90, 50, 80, 45, 65].map((h, idx) => (
                    <span
                      key={idx}
                      className={`w-1.5 rounded-full transition-all duration-200 ${
                        isAgentSpeaking
                          ? 'bg-blue-500 animate-pulse'
                          : isListening
                          ? 'bg-emerald-500'
                          : 'bg-muted-foreground/30'
                      }`}
                      style={{
                        height: isAgentSpeaking || isListening ? `${(h * (0.4 + Math.random() * 0.6))}%` : '20%',
                        animationDelay: `${idx * 80}ms`
                      }}
                    />
                  ))}
                </div>

                {/* Current State Text */}
                <div className="space-y-1">
                  <h4 className="font-bold text-lg">
                    {isAgentSpeaking ? 'SafeSpeak AI is speaking...' : 'Listening to you speak...'}
                  </h4>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Badge variant="outline" className="text-xs bg-background/80 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                      <Sparkles className="w-3 h-3 mr-1 text-emerald-500" />
                      Tone: {currentEmotion}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {inquiryState.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>

                {/* Big Hang Up Button */}
                <div className="pt-4">
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={handleHangUp}
                    className="shadow-xl px-8 py-6 text-base sm:text-lg font-bold rounded-full gap-3 transition-transform hover:scale-105 active:scale-95"
                  >
                    <PhoneOff className="w-5 h-5" />
                    Hang Up & Submit Concern
                  </Button>
                </div>
              </div>

              {/* Spoken Conversation Live Transcript */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span className="font-semibold uppercase tracking-wider">Live Spoken Transcript</span>
                  <span>Audio is not permanently stored • Plaintext reviewed by counselors</span>
                </div>

                <div className={`h-64 overflow-y-auto p-4 rounded-xl border bg-muted/20 space-y-3 font-sans ${transcriptTextClass}`}>
                  {turns.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                      SafeSpeak AI is preparing warm greeting...
                    </div>
                  ) : (
                    turns.map((turn, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-col ${turn.speaker === 'student' ? 'items-end' : 'items-start'} animate-fade-in`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {turn.speaker === 'student' ? 'You' : 'SafeSpeak AI'}
                          </span>
                          {turn.emotion && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              {turn.emotion}
                            </Badge>
                          )}
                        </div>
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                            turn.speaker === 'student'
                              ? 'bg-emerald-600 text-white rounded-tr-none'
                              : 'bg-card border text-card-foreground rounded-tl-none'
                          }`}
                        >
                          {turn.text}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={turnsEndRef} />
                </div>
              </div>

              {/* Progressive Live Extracted Summary */}
              {Object.keys(extractedSlots).length > 0 && (
                <div className="p-4 rounded-xl border bg-card/60 backdrop-blur-sm space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                      <Shield className="w-3.5 h-3.5 text-emerald-500" />
                      Auto-Structured for School Counselors
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600">
                      Syncing to Firebase
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className="p-2 rounded bg-muted/40 border">
                      <span className="text-muted-foreground block text-[10px]">Concern Type</span>
                      <span className="font-bold capitalize">{extractedSlots.category || 'Analyzing...'}</span>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border">
                      <span className="text-muted-foreground block text-[10px]">Location</span>
                      <span className="font-semibold">{extractedSlots.location || 'Optional / Unspecified'}</span>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border">
                      <span className="text-muted-foreground block text-[10px]">Person Mentioned</span>
                      <span className="font-semibold">{extractedSlots.implicated_person || 'Optional'}</span>
                    </div>
                    <div className="p-2 rounded bg-muted/40 border">
                      <span className="text-muted-foreground block text-[10px]">Ongoing?</span>
                      <span className="font-semibold">{extractedSlots.is_ongoing ? 'Yes' : 'Unspecified'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* SCREEN 4: POST-CALL SUBMITTED CONFIRMATION                                */}
          {/* ========================================================================= */}
          {callState === 'completed' && (
            <div className="py-10 px-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-4 animate-fade-in">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto animate-bounce" />
              <div className="space-y-1">
                <h4 className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
                  Your Voice Was Heard
                </h4>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Your concern has been securely saved and routed directly to designated school counselors.
                </p>
              </div>

              {submittedReportId && (
                <div className="p-3 bg-background/80 rounded-xl border inline-block font-mono text-sm">
                  Reference Code: <strong className="text-foreground text-base">{submittedReportId}</strong>
                </div>
              )}

              {idleCountdown !== null && (
                <p className="text-xs text-muted-foreground">
                  Returning to welcome screen in <strong>{idleCountdown}</strong> seconds...
                </p>
              )}

              <div className="pt-2">
                <Button size="sm" variant="outline" onClick={() => setCallState('idle')}>
                  Back to Welcome Screen
                </Button>
              </div>
            </div>
          )}

          {/* Bottom Secondary Switch Banner */}
          <div className="pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5" />
              Prefer not to speak aloud, or want to review details with a keyboard?
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitchToTyping && onSwitchToTyping(extractedSlots)}
              className="gap-1.5 text-xs h-8"
            >
              Switch to Manual Typing Form
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Secondary Laptop WebSocket Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-500" />
              Secondary Laptop AI Server Address
            </DialogTitle>
            <DialogDescription>
              Configure the WebSocket address of the RTX 3050 laptop running Qwen 2.5 7B.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                WebSocket URL (Secondary Laptop LAN IP)
              </label>
              <Input
                value={tempWsUrl}
                onChange={(e) => setTempWsUrl(e.target.value)}
                placeholder="ws://192.168.1.15:8765"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Run <code className="bg-muted px-1 py-0.5 rounded">start-phone-booth-server.bat</code> on your laptop to display its local LAN IP address.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                savePhoneBoothWsUrl(tempWsUrl);
                setServerUrl(tempWsUrl);
                setIsSettingsOpen(false);
                toast.success('AI Server address saved.');
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Save Address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
