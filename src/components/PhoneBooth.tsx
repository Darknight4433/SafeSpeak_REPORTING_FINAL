import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Phone, PhoneOff, PhoneCall, Mic, MicOff, Volume2, Sparkles, Heart, Shield, AlertTriangle, Settings, Wifi, Server, CheckCircle2, ArrowRight, Keyboard, RefreshCw } from 'lucide-react';
import { phoneBoothManager, PhoneBoothTurn, ExtractedReportSlots, getSavedPhoneBoothWsUrl, savePhoneBoothWsUrl } from '@/lib/phoneBoothService';
import { toast } from 'sonner';

interface PhoneBoothProps {
  onSwitchToTyping?: (extractedSlots?: ExtractedReportSlots) => void;
  onReportSubmitted?: (reportId: string) => void;
}

export const PhoneBooth: React.FC<PhoneBoothProps> = ({ onSwitchToTyping, onReportSubmitted }) => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState('Ready');
  const [inquiryState, setInquiryState] = useState('idle');
  const [turns, setTurns] = useState<PhoneBoothTurn[]>([]);
  const [extractedSlots, setExtractedSlots] = useState<ExtractedReportSlots>({});
  const [serverUrl, setServerUrl] = useState(getSavedPhoneBoothWsUrl());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempWsUrl, setTempWsUrl] = useState(serverUrl);
  const [recognition, setRecognition] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);

  const turnsEndRef = useRef<HTMLDivElement | null>(null);
  const durationTimerRef = useRef<number | null>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, isAgentSpeaking]);

  // Handle Call Duration Counter
  useEffect(() => {
    if (isCallActive) {
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
  }, [isCallActive]);

  // Subscribe to Phone Booth Session updates
  useEffect(() => {
    const unsubscribe = phoneBoothManager.subscribe((state) => {
      if (state.isCallActive !== undefined) setIsCallActive(state.isCallActive);
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
        // Automatically restart speech recognition while call is active
        if (isCallActive) {
          try { rec.start(); } catch {}
        }
      };

      setRecognition(rec);
    }
  }, [isCallActive]);

  // Start Call Handler
  const handlePickUp = async () => {
    setIsConnecting(true);
    setSubmittedReportId(null);
    setTurns([]);
    setExtractedSlots({});

    toast.info('Connecting to SafeSpeak AI Voice Booth...', { duration: 3000 });
    const success = await phoneBoothManager.startCall(serverUrl);
    setIsConnecting(false);

    if (success) {
      setIsCallActive(true);
      setIsListening(true);
      if (recognition) {
        try { recognition.start(); } catch {}
      }
      toast.success('Connected. The AI is listening.', { duration: 3000 });
    } else {
      toast.error('Could not connect to AI Server. Please verify the secondary laptop IP in Settings.', {
        duration: 5000,
        action: {
          label: 'Settings',
          onClick: () => setIsSettingsOpen(true)
        }
      });
    }
  };

  // Hang Up Call Handler
  const handleHangUp = async () => {
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    setIsListening(false);

    toast.info('Finalizing conversation and submitting encrypted report to Firebase...', { duration: 4000 });
    const res = await phoneBoothManager.endCall(extractedSlots);

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

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Phone Booth Frame */}
      <Card className="border-2 border-emerald-500/20 shadow-2xl bg-gradient-to-b from-card/95 via-card/90 to-background/95 backdrop-blur-md overflow-hidden relative">
        {/* Top Header Bar */}
        <div className="px-6 py-4 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full ${isCallActive ? 'bg-emerald-500 text-white animate-pulse' : 'bg-muted text-muted-foreground'}`}>
              {isCallActive ? <PhoneCall className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg tracking-tight">SafeSpeak Voice Booth</h3>
                <Badge variant={isConnected ? "default" : "outline"} className={isConnected ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
                  <Wifi className="w-3 h-3 mr-1" />
                  {isConnected ? "AI Assistant Online" : "AI Disconnected (Offline Queue Ready)"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Automated AI support station — connects student concerns directly to trained school counselors.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isCallActive && (
              <Badge variant="secondary" className="font-mono text-sm px-3 py-1 bg-background/80 border">
                ⏱️ {formatTimer(callDuration)}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Configure AI Server IP"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <CardContent className="p-6 space-y-6">
          {/* Main Handset Visual Stage */}
          <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-gradient-to-b from-muted/30 to-muted/10 border border-muted/50 text-center relative overflow-hidden">
            {/* Visual Call Pulse */}
            {isCallActive && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-64 h-64 rounded-full bg-emerald-500/10 animate-ping" />
              </div>
            )}

            {/* Handset Icon & State */}
            <div className="relative mb-4">
              <div className={`w-28 h-28 rounded-full flex items-center justify-center shadow-xl transition-all duration-500 ${
                isCallActive
                  ? 'bg-emerald-500 text-white shadow-emerald-500/30 scale-105'
                  : 'bg-muted text-muted-foreground border-4 border-dashed'
              }`}>
                {isCallActive ? (
                  <PhoneCall className="w-12 h-12 animate-bounce" />
                ) : (
                  <Phone className="w-12 h-12" />
                )}
              </div>

              {isCallActive && isAgentSpeaking && (
                <div className="absolute -bottom-2 -right-2 p-2 rounded-full bg-blue-500 text-white shadow-lg animate-pulse">
                  <Volume2 className="w-4 h-4" />
                </div>
              )}
            </div>

            {/* Call State Title */}
            <h4 className="text-xl font-bold mb-1">
              {isCallActive ? 'Handset Active — SafeSpeak AI is Listening' : 'SafeSpeak Voice Telephone'}
            </h4>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              {isCallActive
                ? 'Speak naturally. SafeSpeak AI listens, supports you, and shares your concern with human counselors. Names and details are completely optional.'
                : 'Pick up the phone to talk directly with SafeSpeak AI. Everything you share is reviewed by caring school counselors.'}
            </p>

            {/* Emotion & Tone Indicator */}
            {isCallActive && (
              <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
                <Badge variant="outline" className="bg-background/80 px-3 py-1 text-xs font-medium border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                  Emotional Tone: {currentEmotion}
                </Badge>
                {isAgentSpeaking && (
                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse">
                    <Volume2 className="w-3 h-3 mr-1" /> Speaking aloud...
                  </Badge>
                )}
                {isListening && !isAgentSpeaking && (
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <Mic className="w-3 h-3 mr-1" /> Listening to you...
                  </Badge>
                )}
              </div>
            )}

            {/* Primary Action Button */}
            <div className="flex items-center gap-4">
              {!isCallActive ? (
                <Button
                  size="lg"
                  onClick={handlePickUp}
                  disabled={isConnecting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 px-8 py-6 text-lg font-semibold rounded-full gap-3 transition-transform hover:scale-105"
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      Connecting Handset...
                    </>
                  ) : (
                    <>
                      <Phone className="w-6 h-6" />
                      Pick Up Phone (Start Call)
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={handleHangUp}
                  className="shadow-lg px-8 py-6 text-lg font-semibold rounded-full gap-3 transition-transform hover:scale-105"
                >
                  <PhoneOff className="w-6 h-6" />
                  Hang Up & Submit Report
                </Button>
              )}
            </div>
          </div>

          {/* Active Call Live Transcript Stream */}
          {isCallActive && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span className="font-semibold uppercase tracking-wider">Live Spoken Conversation</span>
                <span>Encrypted & Recorded for Student Safety</span>
              </div>

              <div className="h-64 overflow-y-auto p-4 rounded-xl border bg-muted/20 space-y-3 font-sans">
                {turns.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                    AI is preparing warm greeting...
                  </div>
                ) : (
                  turns.map((turn, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col ${turn.speaker === 'student' ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {turn.speaker === 'student' ? 'You (Student)' : 'SafeSpeak Companion'}
                        </span>
                        {turn.emotion && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            {turn.emotion}
                          </Badge>
                        )}
                      </div>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
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
          )}

          {/* Background Auto-Extracted Slots Card */}
          {isCallActive && Object.keys(extractedSlots).length > 0 && (
            <div className="p-4 rounded-xl border bg-card/60 backdrop-blur-sm space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-500" />
                  Auto-Extracted Report Details (Updating Live in Background)
                </h5>
                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  Firebase Live Sync Active
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                <div className="p-2 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[10px]">Category</span>
                  <span className="font-semibold capitalize">{extractedSlots.category || 'Analyzing...'}</span>
                </div>
                <div className="p-2 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[10px]">Location</span>
                  <span className="font-semibold">{extractedSlots.location || 'Pending'}</span>
                </div>
                <div className="p-2 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[10px]">Persons Mentioned</span>
                  <span className="font-semibold">{extractedSlots.implicated_person || 'None specified'}</span>
                </div>
                <div className="p-2 rounded bg-muted/40 border">
                  <span className="text-muted-foreground block text-[10px]">Witnesses</span>
                  <span className="font-semibold">{extractedSlots.witnesses || 'None specified'}</span>
                </div>
              </div>

              {extractedSlots.summary && (
                <div className="text-xs text-muted-foreground pt-1 italic">
                  &ldquo;{extractedSlots.summary}&rdquo;
                </div>
              )}
            </div>
          )}

          {/* Post-Call Submission Success Screen */}
          {!isCallActive && submittedReportId && (
            <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h4 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                Voice Call Completed & Report Submitted
              </h4>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Your report ID is <strong className="font-mono text-foreground font-bold">{submittedReportId}</strong>.
                Every word spoken and the synthesized report have been securely saved to Firebase for school counselor review.
              </p>
              <div className="pt-2">
                <Button size="sm" variant="outline" onClick={handlePickUp}>
                  Start Another Call
                </Button>
              </div>
            </div>
          )}

          {/* Secondary Manual Typing Option Banner */}
          <div className="pt-2 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
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

      {/* Settings Dialog for Secondary Laptop WebSocket Configuration */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-5 h-5 text-emerald-500" />
              Secondary Laptop AI Server Settings
            </DialogTitle>
            <DialogDescription>
              Configure the WebSocket address for your secondary laptop equipped with the RTX 3050 running Qwen 2.5 7B.
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
                Run <code className="bg-muted px-1 py-0.5 rounded">start-phone-booth-server.bat</code> on your RTX 3050 laptop to display its exact LAN IP address.
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
