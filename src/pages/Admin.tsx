import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth, database } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { LogOut, FileText, Clock, CheckCircle, User, Mail, MapPin, Calendar, AlertTriangle, ShieldAlert, GraduationCap } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

interface Report {
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
  isEscalated?: boolean;
  escalationMeta?: any;
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

const Admin = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedTab, setSelectedTab] = useState<'all' | 'reports' | 'escalated'>('all');
  const [loading, setLoading] = useState(false);

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

  const filteredReports = reports.filter((r) => {
    if (selectedTab === 'escalated') return r.isEscalated || r.status === 'escalated';
    if (selectedTab === 'reports') return !r.isEscalated && r.status !== 'escalated';
    return true;
  });

  const totalReports = reports.length;
  const pendingReports = reports.filter((r) => r.status === 'pending' || r.status === 'received').length;
  const escalatedCount = reports.filter((r) => r.isEscalated || r.status === 'escalated').length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 py-12 px-4">
        <div className="container max-w-7xl mx-auto space-y-8">
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Admin Dashboard
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Review student reports and escalated safety alerts</p>
            </div>
            <Button onClick={handleLogout} variant="outline">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalReports}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pendingReports}</div>
              </CardContent>
            </Card>
            <Card className="border-red-200 dark:border-red-900/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">Escalated (Higher Authority)</CardTitle>
                <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{escalatedCount}</div>
              </CardContent>
            </Card>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 border-b pb-3">
            <Button
              variant={selectedTab === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedTab('all')}
            >
              All Reports ({totalReports})
            </Button>
            <Button
              variant={selectedTab === 'reports' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSelectedTab('reports')}
            >
              Standard Reports ({totalReports - escalatedCount})
            </Button>
            <Button
              variant={selectedTab === 'escalated' ? 'destructive' : 'ghost'}
              size="sm"
              onClick={() => setSelectedTab('escalated')}
            >
              Higher Authority Escalations ({escalatedCount})
            </Button>
          </div>

          <div className="space-y-4">
            {filteredReports.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No reports found in this category.
              </div>
            ) : (
              filteredReports.map((report) => (
                <Card key={report.id} className={`overflow-hidden border transition-all ${report.isEscalated ? 'border-red-300 dark:border-red-900 bg-red-50/20' : ''}`}>
                  <CardHeader className={report.isEscalated ? 'bg-red-50 dark:bg-red-950/20' : 'bg-gradient-to-r from-primary/5 to-secondary/5'}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-lg font-bold">
                            {report.reportId}
                          </Badge>
                          <span className="text-2xl">{categoryIcons[report.category] || '📋'}</span>
                          <CardTitle className="capitalize">{report.category?.replace(/_/g, ' ')}</CardTitle>
                          {report.isEscalated && (
                            <Badge className="bg-red-600 text-white flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" />
                              Higher Authority Escalated
                            </Badge>
                          )}
                          {report.riskLevel && (
                            <Badge variant={report.riskLevel === 'L3' ? 'destructive' : 'secondary'}>
                              {report.riskLevel}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatTimestamp(report.timestamp)}
                          </div>
                          {report.isAnonymous ? (
                            <Badge variant="secondary">Anonymous</Badge>
                          ) : (
                            <Badge variant="default">Named Report</Badge>
                          )}
                          <Badge variant={report.status === 'pending' || report.status === 'received' ? 'destructive' : 'default'}>
                            {report.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium mb-1">Description:</p>
                        <p className="text-sm text-foreground bg-muted/30 p-3 rounded-md whitespace-pre-wrap">{report.description}</p>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
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
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Admin;
