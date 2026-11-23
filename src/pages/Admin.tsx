import { useEffect, useState } from 'react';
import { ref, onValue, get } from 'firebase/database';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth, database } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  LogOut,
  FileText,
  Clock,
  CheckCircle,
  User,
  Mail,
  MapPin,
  Calendar,
  AlertTriangle,
  ShieldAlert,
  GraduationCap,
  Mic,
  MessageSquare,
  Sparkles,
  Bot,
  Heart,
  Shield,
  Activity,
  AlertOctagon,
  HelpCircle,
  Layers
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export interface PhoneBoothTurn {
  turn: number;
  speaker: 'student' | 'agent';
  text: string;
  emotion?: string;
  timestamp: number;
}

export interface VoiceAnalytics {
  durationSeconds?: number;
  totalTurns?: number;
  studentTurns?: number;
  agentTurns?: number;
  detectedEmotions?: string[];
  concludingEmotion?: string;
  speechEngine?: string;
}

export interface ExtractedSlots {
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
  detected_emotion?: string;
}

export interface Report {
  id: string;
  reportId: string;
  reportNumber: number;
  category: string;
  description: string;
  isAnonymous: boolean;
  name?: string;
  age?: string;
  location?: string;
  classroom?: string;
  implicatedName?: string;
  bullyName?: string;
  contact?: string;
  timestamp: any;
  status: string;
  riskLevel?: string;
  severityLevel?: string;
  isEscalated?: boolean;
  escalationMeta?: any;
  source?: string;
  durationSeconds?: number;
  conversationId?: string;
  transcript?: PhoneBoothTurn[];
  voiceAnalytics?: VoiceAnalytics;
  extractedSlots?: ExtractedSlots;
  aiSummary?: string;
  escalation_decision?: {
    reporting_pathway?: string;
    reason?: string;
  };
  safety_flags?: {
    urgent_review?: boolean;
    human_review_required?: boolean;
  };
}

const categoryIcons: Record<string, string> = {
  bullying: '😢',
  abuse: '🆘',
  academic: '📚',
  family: '👨‍👩‍👧‍👦',
  safety: '⚠️',
  other: '💬',
  teacher_involved: '🚨',
  physical_threat: '⚠️',
  sexual_abuse: '🛑',
  self_harm: '❤️‍🩹',
};

const formatTimestamp = (ts: any) => {
  if (!ts) return 'Recently';
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
    if (isNaN(d.getTime())) return 'Recently';
    return format(d, 'PPP p');
  } catch {
    return 'Recently';
  }
};

const formatDuration = (seconds?: number) => {
  if (!seconds || seconds <= 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const Admin = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedTab, setSelectedTab] = useState<'all' | 'voice' | 'standard' | 'escalated'>('all');
  const [loading, setLoading] = useState(false);

  // Transcript Dialog Modal State
  const [selectedReportForTranscript, setSelectedReportForTranscript] = useState<Report | null>(null);
  const [modalTranscript, setModalTranscript] = useState<PhoneBoothTurn[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      let reportsMap: Record<string, any> = {};
      let escalatedMap: Record<string, any> = {};

      const updateCombinedReports = () => {
        const standardList: Report[] = Object.entries(reportsMap).map(([id, r]: [string, any]) => ({
          id,
          ...r,
          isEscalated: false,
        }));

        const escalatedList: Report[] = Object.entries(escalatedMap).map(([id, r]: [string, any]) => ({
          id: `esc_${id}`,
          ...r,
          isEscalated: true,
          status: r.status || 'escalated',
        }));

        const seenKeys = new Set<string>();
        const combined: Report[] = [];

        [...escalatedList, ...standardList].forEach((item) => {
          const key = item.reportId || item.id;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            combined.push(item);
          }
        });

        combined.sort((a, b) => (b.reportNumber || 0) - (a.reportNumber || 0));
        setReports(combined);
      };

      const reportsRef = ref(database, 'reports');
      const unsubReports = onValue(reportsRef, (snapshot) => {
        reportsMap = snapshot.val() || {};
        updateCombinedReports();
      }, (err) => console.warn('Reports read error:', err));

      const escalatedRef = ref(database, 'higher_authority_reports');
      const unsubEscalated = onValue(escalatedRef, (snapshot) => {
        escalatedMap = snapshot.val() || {};
        updateCombinedReports();
      }, (err) => console.warn('Escalated reports read error:', err));

      return () => {
        unsubReports();
        unsubEscalated();
      };
    }
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast.success('Logged in successfully');
    } catch (error) {
      toast.error('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success('Logged out successfully');
    } catch (error) {
      toast.error('Failed to logout');
    }
  };

  // Open transcript dialog and fetch from database if not embedded in report payload
  const handleOpenTranscript = async (report: Report) => {
    setSelectedReportForTranscript(report);
    if (report.transcript && report.transcript.length > 0) {
      setModalTranscript(report.transcript);
      return;
    }

    if (report.conversationId) {
      setLoadingTranscript(true);
      try {
        const transcriptRef = ref(database, `conversations/${report.conversationId}/transcript`);
        const snapshot = await get(transcriptRef);
        if (snapshot.exists()) {
          const val = snapshot.val();
          const turnList: PhoneBoothTurn[] = Object.values(val);
          turnList.sort((a, b) => a.turn - b.turn);
          setModalTranscript(turnList);
        } else {
          setModalTranscript([]);
        }
      } catch (err) {
        console.warn('Failed to load conversation transcript:', err);
        setModalTranscript([]);
      } finally {
        setLoadingTranscript(false);
      }
    } else {
      setModalTranscript([]);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Admin Login</CardTitle>
              <CardDescription>Authorized personnel only</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Logging in...' : 'Login'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  const isVoiceReport = (r: Report) => {
    return r.source === 'phone_booth_voice_agent' || !!r.voiceAnalytics || !!r.transcript || !!r.conversationId;
  };

  const filteredReports = reports.filter((r) => {
    if (selectedTab === 'escalated') return r.isEscalated || r.status === 'escalated';
    if (selectedTab === 'voice') return isVoiceReport(r);
    if (selectedTab === 'standard') return !isVoiceReport(r);
    return true;
  });

  const totalReports = reports.length;
  const pendingReports = reports.filter((r) => r.status === 'pending' || r.status === 'received' || r.status === 'pending_review').length;
  const escalatedCount = reports.filter((r) => r.isEscalated || r.status === 'escalated').length;
  const voiceReportsCount = reports.filter(isVoiceReport).length;
  const manualReportsCount = totalReports - voiceReportsCount;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 py-12 px-4">
        <div className="container max-w-7xl mx-auto space-y-8">
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                  Admin Safeguarding Dashboard
                </h1>
                <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                  Realtime Monitoring
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Live child welfare reports, SafeSpeak Voice AI conversation analytics, and higher authority safety escalations
              </p>
            </div>
            <Button onClick={handleLogout} variant="outline">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <Card className="shadow-sm border-border/80">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Incident Reports</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold">{totalReports}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {manualReportsCount} Web Form • {voiceReportsCount} Voice AI
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-purple-200 dark:border-purple-900/40 bg-purple-50/20 dark:bg-purple-950/10">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  Voice AI Phone Booth
                </CardTitle>
                <Mic className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-purple-700 dark:text-purple-300">{voiceReportsCount}</div>
                <p className="text-xs text-purple-600/80 dark:text-purple-400/80 mt-1">
                  Spoken AI Intake with live emotion tracking
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-amber-200 dark:border-amber-900/40 bg-amber-50/20 dark:bg-amber-950/10">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-300">Pending Review</CardTitle>
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-amber-700 dark:text-amber-300">{pendingReports}</div>
                <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">
                  Awaiting counselor follow-up
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-red-200 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/10">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">Higher Authority Alert</CardTitle>
                <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-red-600 dark:text-red-400">{escalatedCount}</div>
                <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
                  Staff implicated or critical severity (L3)
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-2 border-b pb-3">
            <Button
              variant={selectedTab === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedTab('all')}
            >
              All Reports ({totalReports})
            </Button>
            <Button
              variant={selectedTab === 'voice' ? 'default' : 'ghost'}
              size="sm"
              className={selectedTab === 'voice' ? 'bg-purple-600 hover:bg-purple-700 text-white' : ''}
              onClick={() => setSelectedTab('voice')}
            >
              <Mic className="w-3.5 h-3.5 mr-1.5" />
              Voice AI Reports ({voiceReportsCount})
            </Button>
            <Button
              variant={selectedTab === 'standard' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedTab('standard')}
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Manual Web Form ({manualReportsCount})
            </Button>
            <Button
              variant={selectedTab === 'escalated' ? 'destructive' : 'ghost'}
              size="sm"
              onClick={() => setSelectedTab('escalated')}
            >
              <ShieldAlert className="w-3.5 h-3.5 mr-1.5" />
              Higher Authority Escalations ({escalatedCount})
            </Button>
          </div>

          {/* Reports List */}
          <div className="space-y-5">
            {filteredReports.length === 0 ? (
              <div className="text-center py-16 bg-muted/20 border border-dashed rounded-xl text-muted-foreground">
                <CheckCircle className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-base font-medium">No reports found in this view.</p>
                <p className="text-xs text-muted-foreground mt-1">Any new spoken or typed reports will update automatically in real-time.</p>
              </div>
            ) : (
              filteredReports.map((report) => {
                const voice = isVoiceReport(report);
                const slots = report.extractedSlots || {};
                const duration = report.durationSeconds || report.voiceAnalytics?.durationSeconds;
                const turnCount = report.voiceAnalytics?.totalTurns || (report.transcript ? report.transcript.length : undefined);
                const concludingEmotion = report.voiceAnalytics?.concludingEmotion || slots.detected_emotion;

                return (
                  <Card
                    key={report.id}
                    className={`overflow-hidden border transition-all shadow-sm hover:shadow-md ${
                      report.isEscalated
                        ? 'border-red-300 dark:border-red-900 bg-red-50/15'
                        : voice
                        ? 'border-purple-200 dark:border-purple-900/40'
                        : ''
                    }`}
                  >
                    <CardHeader className={
                      report.isEscalated
                        ? 'bg-red-50/70 dark:bg-red-950/20'
                        : voice
                        ? 'bg-purple-50/40 dark:bg-purple-950/20'
                        : 'bg-gradient-to-r from-primary/5 to-secondary/5'
                    }>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-base font-bold tracking-tight">
                              {report.reportId}
                            </Badge>
                            <span className="text-2xl" role="img" aria-label="category">
                              {categoryIcons[report.category] || '📋'}
                            </span>
                            <CardTitle className="text-lg capitalize">
                              {report.category?.replace(/_/g, ' ')}
                            </CardTitle>

                            {/* Source Badge: Voice vs Web */}
                            {voice ? (
                              <Badge className="bg-purple-600 hover:bg-purple-700 text-white gap-1 text-xs">
                                <Mic className="w-3 h-3" />
                                SafeSpeak Voice AI
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground gap-1 text-xs">
                                <FileText className="w-3 h-3" />
                                Web Form
                              </Badge>
                            )}

                            {/* Escalation Badge */}
                            {report.isEscalated && (
                              <Badge className="bg-red-600 text-white flex items-center gap-1 text-xs">
                                <ShieldAlert className="h-3 w-3" />
                                Higher Authority Escalated
                              </Badge>
                            )}

                            {/* Severity Level Badge */}
                            {(report.severityLevel || slots.severity_level) && (
                              <Badge
                                variant={
                                  (report.severityLevel || slots.severity_level) === 'L3'
                                    ? 'destructive'
                                    : (report.severityLevel || slots.severity_level) === 'L2'
                                    ? 'secondary'
                                    : 'outline'
                                }
                                className="text-xs font-semibold"
                              >
                                {report.severityLevel || slots.severity_level} Severity
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatTimestamp(report.timestamp)}
                            </div>

                            {report.isAnonymous ? (
                              <Badge variant="secondary" className="text-[11px]">Anonymous</Badge>
                            ) : (
                              <Badge variant="default" className="text-[11px]">
                                Named Report {report.name ? `(${report.name})` : ''}
                              </Badge>
                            )}

                            <Badge
                              variant={report.status === 'pending' || report.status === 'received' || report.status === 'pending_review' ? 'destructive' : 'default'}
                              className="text-[11px]"
                            >
                              {report.status}
                            </Badge>
                          </div>
                        </div>

                        {/* Action: Open Spoken Conversation Transcript */}
                        {voice && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-100/50 dark:hover:bg-purple-900/40 font-medium"
                            onClick={() => handleOpenTranscript(report)}
                          >
                            <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            View AI Transcript
                            {turnCount ? ` (${turnCount} turns)` : ''}
                          </Button>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="pt-5 space-y-4">
                      {/* AI Voice Analytics Strip (When from Voice Booth) */}
                      {voice && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-purple-50/40 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 rounded-lg text-xs">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            <div>
                              <p className="text-muted-foreground">Call Duration</p>
                              <p className="font-bold text-foreground">{formatDuration(duration)}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            <div>
                              <p className="text-muted-foreground">AI Engine</p>
                              <p className="font-bold text-foreground">Llama 3.2 3B</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Heart className="w-4 h-4 text-rose-500" />
                            <div>
                              <p className="text-muted-foreground">Concluding Emotion</p>
                              <p className="font-bold text-foreground">{concludingEmotion || 'Listening'}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-emerald-600" />
                            <div>
                              <p className="text-muted-foreground">AI Routing Pathway</p>
                              <p className="font-bold text-foreground">
                                {report.isEscalated ? 'Higher Authority' : 'School Counselor'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Incident Description / AI Summary */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {voice ? 'AI Structured Incident Report:' : 'Student Incident Description:'}
                          </p>
                          {voice && (
                            <span className="text-[11px] text-purple-600 dark:text-purple-400 flex items-center gap-1 font-medium">
                              <Sparkles className="w-3 h-3" /> Synthesized by SafeSpeak AI
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground bg-muted/30 p-3.5 rounded-md whitespace-pre-wrap leading-relaxed border border-border/40">
                          {report.aiSummary || slots.summary || report.description}
                        </p>
                      </div>

                      {/* Voice AI Safeguarding & Risk Extraction Grid */}
                      {voice && (() => {
                        const loc = slots.location || report.location || report.incident?.location;
                        const time = slots.incident_timeframe || report.incidentTimeframe || report.incident?.time_context;
                        const imp = slots.implicated_person || report.implicatedName || report.incident?.implicated_person;
                        const wit = slots.witnesses_present || report.witnessesPresent || report.incident?.witnesses_present;
                        const harm = slots.physical_harm_indicated ?? report.physicalHarmIndicated ?? report.safety_flags?.physical_harm_indicated;
                        const danger = slots.immediate_danger ?? report.safety_flags?.immediate_danger ?? report.safety_flags?.urgent_review;
                        const ongoing = slots.is_ongoing ?? (report.incident?.frequency === 'repeated');
                        const escReason = report.escalation_decision?.reason || report.escalationMeta?.escalated_reason;

                        return (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t text-xs">
                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Location</span>
                              <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 text-muted-foreground" /> {loc || 'Campus / General'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Timeframe</span>
                              <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                <Clock className="w-3 h-3 text-muted-foreground" /> {time || 'Recently Reported'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Implicated Person</span>
                              <span className={`font-semibold flex items-center gap-1 mt-0.5 ${imp ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                                <AlertTriangle className="w-3 h-3" /> {imp || 'Not specified'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Witnesses</span>
                              <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                <User className="w-3 h-3 text-muted-foreground" /> {wit || 'None mentioned'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Physical Harm</span>
                              <span className={`font-semibold flex items-center gap-1 mt-0.5 ${harm ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                                {harm ? '⚠️ Indicated' : 'None Reported'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Immediate Danger</span>
                              <span className={`font-semibold flex items-center gap-1 mt-0.5 ${danger ? 'text-destructive font-bold' : 'text-emerald-600'}`}>
                                {danger ? '🚨 Critical Danger' : 'No Immediate Risk'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border">
                              <span className="text-muted-foreground block text-[11px]">Frequency</span>
                              <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                {ongoing ? '🔄 Repeated / Ongoing' : 'Single Occurrence'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded bg-muted/40 border col-span-2 md:col-span-1">
                              <span className="text-muted-foreground block text-[11px]">AI Escalation Rationale</span>
                              <span className="font-medium text-foreground truncate block mt-0.5" title={escReason || 'Automated Safeguarding Review'}>
                                {escReason || (report.isEscalated ? 'Staff implicated / Critical' : 'Standard Counselor Intake')}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Manual Form Metadata Grid */}
                      {!voice && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t">
                          {report.age && (
                            <div className="flex items-center gap-2 text-sm">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span>Age: {report.age}</span>
                            </div>
                          )}
                          {report.classroom && (
                            <div className="flex items-center gap-2 text-sm">
                              <GraduationCap className="h-4 w-4 text-muted-foreground" />
                              <span>Class: {report.classroom}</span>
                            </div>
                          )}
                          {report.location && (
                            <div className="flex items-center gap-2 text-sm">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span>{report.location}</span>
                            </div>
                          )}
                          {!report.isAnonymous && report.name && (
                            <div className="flex items-center gap-2 text-sm">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span>Reporter: {report.name}</span>
                            </div>
                          )}
                          {report.implicatedName && (
                            <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                              <AlertTriangle className="h-4 w-4" />
                              <span>Teacher/Staff: {report.implicatedName}</span>
                            </div>
                          )}
                          {report.bullyName && (
                            <div className="flex items-center gap-2 text-sm text-orange-600 font-medium">
                              <AlertTriangle className="h-4 w-4" />
                              <span>Bully: {report.bullyName}</span>
                            </div>
                          )}
                          {!report.isAnonymous && report.contact && (
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              <span>{report.contact}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </main>

      {/* Transcript Modal Dialog */}
      <Dialog
        open={!!selectedReportForTranscript}
        onOpenChange={(open) => {
          if (!open) setSelectedReportForTranscript(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b bg-purple-50/50 dark:bg-purple-950/20">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-bold">
                    {selectedReportForTranscript?.reportId}
                  </Badge>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    <Mic className="w-5 h-5 text-purple-600" />
                    Spoken Voice AI Conversation Transcript
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Recorded in SafeSpeak Phone Booth with Sarah (Llama 3.2 3B Engine) • {formatTimestamp(selectedReportForTranscript?.timestamp)}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Transcript Scroll Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {loadingTranscript ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <Clock className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-600" />
                Loading spoken dialogue turns...
              </div>
            ) : modalTranscript.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <HelpCircle className="w-8 h-8 mx-auto text-muted-foreground/60 mb-2" />
                No turn-by-turn dialogue logged for this session.
              </div>
            ) : (
              modalTranscript.map((turn, idx) => {
                const isStudent = turn.speaker === 'student';
                return (
                  <div
                    key={idx}
                    className={`flex flex-col ${isStudent ? 'items-end' : 'items-start'} space-y-1`}
                  >
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                        {isStudent ? (
                          <>
                            <User className="w-3 h-3 text-blue-500" /> Student
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 text-purple-500" /> SafeSpeak AI Counselor
                          </>
                        )}
                      </span>
                      {turn.emotion && !isStudent && (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          {turn.emotion}
                        </Badge>
                      )}
                    </div>

                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                        isStudent
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-muted/80 text-foreground border border-border/60 rounded-bl-sm'
                      }`}
                    >
                      {turn.text}
                    </div>

                    <span className="text-[10px] text-muted-foreground/70 px-1">
                      {formatTimestamp(turn.timestamp)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-4 border-t bg-muted/20 flex justify-between items-center text-xs text-muted-foreground">
            <span>
              Total Turns: <strong className="text-foreground">{modalTranscript.length}</strong> • Call Duration:{' '}
              <strong className="text-foreground">{formatDuration(selectedReportForTranscript?.durationSeconds)}</strong>
            </span>
            <Button size="sm" variant="outline" onClick={() => setSelectedReportForTranscript(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
};

export default Admin;