import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ref, push, serverTimestamp } from 'firebase/database';
import { database } from '@/lib/firebase';
import { getNextReportNumber, formatReportId } from '@/lib/reportUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Loader2,
  Shield,
  Phone,
  UserX,
  User,
  Users,
  AlertTriangle,
  BookOpen,
  Home,
  Heart,
  Mic,
  CheckCircle,
  Copy,
  UserCheck,
  Building,
  Sparkles
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SCHOOL_CONFIG } from '@/config/school';
import { sanitizeForFirebase } from '@/lib/reportUtils';
import { PhoneBooth } from '@/components/PhoneBooth';
import type { ExtractedReportSlots } from '@/lib/phoneBoothService';

// Category Definitions with clear visual identifiers
const categories = [
  {
    value: 'bullying',
    label: 'Bullying / Harassment',
    description: 'Peer harassment, teasing, or physical bullying by fellow students',
    icon: Users,
    color: 'text-amber-600 dark:text-amber-400',
    borderActive: 'border-amber-500 bg-amber-500/10'
  },
  {
    value: 'teacher',
    label: 'Teacher / Staff Concern',
    description: 'Misconduct, unfair treatment, or abuse involving a teacher or school staff',
    icon: UserCheck,
    color: 'text-purple-600 dark:text-purple-400',
    borderActive: 'border-purple-500 bg-purple-500/10'
  },
  {
    value: 'abuse',
    label: 'Physical / Emotional Abuse',
    description: 'Threats, physical violence, or extreme emotional harm',
    icon: AlertTriangle,
    color: 'text-red-600 dark:text-red-400',
    borderActive: 'border-red-500 bg-red-500/10'
  },
  {
    value: 'academic',
    label: 'Academic Pressure',
    description: 'Severe exam anxiety, excessive workload, or extreme academic distress',
    icon: BookOpen,
    color: 'text-blue-600 dark:text-blue-400',
    borderActive: 'border-blue-500 bg-blue-500/10'
  },
  {
    value: 'safety',
    label: 'Campus Safety',
    description: 'Hazardous areas, broken equipment, trespassing, or safety risks',
    icon: Shield,
    color: 'text-emerald-600 dark:text-emerald-400',
    borderActive: 'border-emerald-500 bg-emerald-500/10'
  },
  {
    value: 'other',
    label: 'Other Concern',
    description: 'Personal, family, or any other situation you need support with',
    icon: Heart,
    color: 'text-pink-600 dark:text-pink-400',
    borderActive: 'border-pink-500 bg-pink-500/10'
  },
];

const intensityLevels = [
  { value: 'low', label: 'Low', description: 'Minor / informational', color: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300' },
  { value: 'medium', label: 'Medium', description: 'Moderate concern', color: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-300' },
  { value: 'high', label: 'High', description: 'Serious issue', color: 'bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-300' },
  { value: 'extreme', label: 'Critical', description: 'Urgent immediate attention', color: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300' },
];

const formSchema = z.object({
  category: z.string().min(1, 'Please select a category'),
  intensity: z.string().default('medium'),
  description: z.string().min(3, 'Please describe what happened (at least 3 characters)'),
  age: z.string().optional(),
  location: z.string().optional(),
  name: z.string().optional(),
  contact: z.string().optional(),
  classroom: z.string().optional(),
  bullyName: z.string().optional(),
  implicatedName: z.string().optional(),
  isAnonymous: z.boolean().default(false),
  personType: z.string().default('student'),
});

const Report = () => {
  // Primary Voice Phone Booth vs Manual form switch (defaults to Phone Booth)
  const [reportingMode, setReportingMode] = useState<'manual' | 'booth'>('booth');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);

  // Success Confirmation Modal
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [submittedReportId, setSubmittedReportId] = useState<string>('');

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: '',
      intensity: 'medium',
      description: '',
      age: '',
      location: SCHOOL_CONFIG.name,
      name: '',
      contact: '',
      classroom: '',
      bullyName: '',
      implicatedName: '',
      isAnonymous: false,
      personType: 'student',
    },
  });

  // Watch form fields for clean conditional rendering
  const selectedCategory = form.watch('category');
  const selectedPersonType = form.watch('personType');
  const isTeacherSelected = selectedCategory === 'teacher' || selectedPersonType === 'teacher' || selectedPersonType === 'staff';
  const isBullyingSelected = selectedCategory === 'bullying';

  // Speech Recognition Setup (for optional mic button in manual form)
  useEffect(() => {
    let instance: any = null;
    import('@/lib/speech').then(({ createRecognition }) => {
      instance = createRecognition({ lang: 'en-US', continuous: true, interimResults: true });
      if (instance && instance.isSupported) {
        instance.onResult = (text: string) => {
          form.setValue('description', text);
        };
        instance.onError = (err: any) => {
          console.warn('Speech recognition warning:', err);
          setIsRecording(false);
        };
        instance.onEnd = () => {
          setIsRecording(false);
        };
        setRecognition(instance);
      }
    }).catch(() => {
      // Speech recognition optional
    });

    return () => {
      if (instance) {
        try { instance.stop(); } catch (e) { /* ignore */ }
      }
    };
  }, [form]);

  const toggleRecording = () => {
    if (!recognition || !recognition.isSupported) {
      toast.error('Voice input is not supported in this browser. Please type your report.');
      return;
    }
    if (isRecording) {
      try { recognition.stop(); } catch (e) {}
      setIsRecording(false);
      toast.info('Voice recording stopped.');
    } else {
      try {
        recognition.start();
        setIsRecording(true);
        toast.success('Listening... Speak into your microphone.');
      } catch (err) {
        console.error('Could not start recognition:', err);
        setIsRecording(false);
        toast.error('Microphone access unavailable. Please type your report.');
      }
    }
  };

  const handleSwitchToTyping = (slots?: ExtractedReportSlots) => {
    if (slots) {
      if (slots.category) {
        form.setValue('category', slots.category);
        if (slots.category === 'teacher_involved') {
          form.setValue('category', 'teacher');
          form.setValue('personType', 'teacher');
        }
      }
      if (slots.location) form.setValue('location', slots.location);
      if (slots.implicated_person) {
        form.setValue('implicatedName', slots.implicated_person);
        form.setValue('bullyName', slots.implicated_person);
      }
      if (slots.summary) form.setValue('description', slots.summary);
    }
    setReportingMode('manual');
    toast.info('Switched to manual typing. Details pre-filled.');
  };

  // Direct, rock-solid submission without any AI locks or delays
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);

    try {
      // Comprehensive check: Does this report involve a teacher or school staff member?
      const textHasTeacher = /\b(teacher|t\.?r\.?|staff|principal|faculty|sir|madam|prof)\b/i.test(values.description || '');
      const isTeacher = values.category === 'teacher' ||
                        values.category === 'teacher_involved' ||
                        values.personType === 'teacher' ||
                        values.personType === 'staff' ||
                        Boolean(values.implicatedName && values.implicatedName.trim()) ||
                        textHasTeacher;

      // 1. Validate Teacher/Staff specific requirements
      if (isTeacher) {
        if (!values.implicatedName || !values.implicatedName.trim()) {
          form.setError('implicatedName', { type: 'required', message: 'Please provide the name of the teacher or staff member' });
          toast.error('Please enter the name of the teacher/staff member.');
          setIsSubmitting(false);
          return;
        }
        if (!values.classroom || !values.classroom.trim()) {
          form.setError('classroom', { type: 'required', message: 'Class/Grade is required for staff reports' });
          toast.error('Please enter your class / section.');
          setIsSubmitting(false);
          return;
        }
        if (!values.name || !values.name.trim()) {
          form.setError('name', { type: 'required', message: 'Your name is required for reports involving staff' });
          toast.error('Your name is required so the Child Protection Board can investigate.');
          setIsSubmitting(false);
          return;
        }
        values.isAnonymous = false;
      }

      // 2. Default Anonymous flag for general reports
      if (!isTeacher && (!values.name || values.name.trim() === '')) {
        values.isAnonymous = true;
      }

      toast.loading('Submitting your report securely...', { id: 'submit-toast' });

      // Generate Report ID
      const reportNumber = await getNextReportNumber();
      const reportId = formatReportId(reportNumber);

      // Routing: Teacher/Staff reports route STRICTLY to higher_authority_reports
      const targetPath = isTeacher ? 'higher_authority_reports' : 'reports';
      const schoolName = isTeacher ? 'MGM Model School Ayiroor Varkala' : (values.location || SCHOOL_CONFIG.name);

      const reportPayload: Record<string, any> = {
        reportId,
        reportNumber,
        category: isTeacher ? 'teacher_involved' : (values.category || 'other'),
        intensity: values.intensity || 'medium',
        description: values.description,
        personType: isTeacher ? 'teacher' : (values.personType || 'student'),
        implicatedName: values.implicatedName?.trim() || null,
        bullyName: values.bullyName?.trim() || null,
        name: values.isAnonymous ? 'Anonymous' : (values.name?.trim() || 'Anonymous'),
        contact: values.contact?.trim() || null,
        classroom: values.classroom?.trim() || null,
        age: values.age?.trim() || null,
        isAnonymous: Boolean(values.isAnonymous),
        school: schoolName,
        original_location: values.location || SCHOOL_CONFIG.name,
        timestamp: serverTimestamp(),
        status: isTeacher ? 'escalated' : (values.intensity === 'extreme' ? 'escalated' : 'received'),
        riskLevel: isTeacher ? 'High' : (values.intensity === 'extreme' ? 'Critical' : (values.intensity === 'high' ? 'High' : 'Normal')),
        source: 'manual_web',
        isEscalated: isTeacher || values.intensity === 'extreme',
      };

      // Mandatory AI Structured Report attached to every submission
      const isExtreme = values.intensity === 'extreme';
      const isHigh = values.intensity === 'high' || isTeacher;
      const severity = isExtreme ? 'L3' : isHigh ? 'L2' : 'L1';
      const categoryVal = isTeacher ? 'teacher_involved' : (values.category || 'other');
      const implicatedVal = values.implicatedName?.trim() || values.bullyName?.trim() || null;
      const reporterVal = values.isAnonymous ? 'Anonymous' : (values.name?.trim() || 'Anonymous');

      const manualStructuredReport = {
        report_id: reportId,
        generated_at: Date.now(),
        source: 'manual_web',
        executive_summary: values.description ? (values.description.length > 200 ? values.description.slice(0, 200) + '...' : values.description) : `Manual safeguarding report (${categoryVal})`,
        incident_classification: {
          category: categoryVal,
          severity_level: severity,
          risk_level: isTeacher || isExtreme ? 'Critical' : isHigh ? 'High' : 'Normal',
          intensity: values.intensity || 'medium',
          escalation_pathway: isTeacher || isExtreme ? 'higher_authority' : 'normal',
          escalation_reason: isTeacher ? 'Report implicates school teacher or staff member' : isExtreme ? 'Reporter indicated critical urgency' : 'Standard pastoral intake'
        },
        extracted_entities: {
          location: values.location || SCHOOL_CONFIG.name,
          classroom: values.classroom?.trim() || null,
          incident_timeframe: 'Recently Reported',
          implicated_person: implicatedVal,
          reporter_identity: reporterVal,
          age: values.age || null
        },
        safety_and_danger_assessment: {
          immediate_danger: isExtreme,
          physical_harm_indicated: isExtreme || values.intensity === 'high',
          is_ongoing_or_scheduled: values.intensity === 'high' || isExtreme,
          urgent_action_required: isTeacher || isExtreme
        },
        recommended_action_plan: isTeacher ? [
          'Immediate confidential notification of Designated Safeguarding Lead (DSL)',
          'Protect student identity and prevent staff retaliation'
        ] : isExtreme ? [
          'Immediate administrative safety intervention',
          'Coordinate with campus security and counselor lead'
        ] : [
          'Assign counselor for intake assessment',
          'Monitor student well-being during school hours'
        ]
      };

      reportPayload.structured_report = manualStructuredReport;
      reportPayload.ai_structured_report = manualStructuredReport;

      if (isTeacher) {
        reportPayload.escalationMeta = {
          escalated_by: 'teacher_staff_involvement',
          escalated_reason: 'Report implicates school teacher or staff member',
          timestamp: serverTimestamp(),
        };
      }

      console.log(`Writing to Firebase (${targetPath})...`, reportPayload);

      const targetRef = ref(database, targetPath);
      const cleanPayload = sanitizeForFirebase(reportPayload);
      const res = await push(targetRef, cleanPayload);

      // If critical urgency on non-teacher report, mirror to higher_authority_reports
      if (!isTeacher && values.intensity === 'extreme') {
        try {
          const higherRef = ref(database, 'higher_authority_reports');
          await push(higherRef, {
            ...reportPayload,
            escalationMeta: {
              escalated_by: 'urgency_extreme',
              escalated_reason: 'Reporter indicated critical urgency',
              original_report_key: res?.key || null,
              timestamp: serverTimestamp(),
            }
          });
        } catch (e) {
          console.warn('Higher authority mirror fallback:', e);
        }
      }

      toast.dismiss('submit-toast');
      toast.success(`Report submitted successfully! Tracking ID: ${reportId}`, { duration: 6000 });

      // Show confirmation dialog with Tracking ID
      setSubmittedReportId(reportId);
      setSuccessModalOpen(true);

      // Reset form
      form.reset({
        category: '',
        intensity: 'medium',
        description: '',
        age: '',
        location: SCHOOL_CONFIG.name,
        name: '',
        contact: '',
        classroom: '',
        bullyName: '',
        implicatedName: '',
        isAnonymous: false,
        personType: 'student',
      });
      setIsAnonymous(false);

    } catch (err: any) {
      console.error('Submission error:', err);
      toast.dismiss('submit-toast');
      toast.error('Could not submit report to server. Please check connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyTrackingId = () => {
    if (submittedReportId) {
      navigator.clipboard.writeText(submittedReportId);
      toast.success('Tracking ID copied to clipboard!');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <Navbar />
      <main className="flex-1 py-10 px-4">
        <div className="container max-w-3xl mx-auto space-y-6">

          {/* Page Header */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary via-primary-glow to-secondary bg-clip-text text-transparent">
              Submit a Confidential Report
            </h1>
            <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
              Your safety and privacy are 100% protected. Choose what happened below to get help.
            </p>
          </div>

          {/* Mode Switch Bar: Voice Phone Booth (Primary) vs. Manual Typing Form */}
          <div className="flex items-center justify-center gap-2 p-1.5 rounded-2xl bg-muted/60 border max-w-md mx-auto shadow-sm">
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
              Voice Phone Booth (AI Station)
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
              Manual Typing Form
            </button>
          </div>

          {reportingMode === 'booth' ? (
            <PhoneBooth
              onSwitchToTyping={handleSwitchToTyping}
              onReportSubmitted={(reportId) => {
                setSubmittedReportId(reportId);
              }}
            />
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit, (errors) => {
                  console.warn('Form validation errors:', errors);
                  const first = Object.values(errors)[0]?.message || 'Please fill in the required fields.';
                  toast.error(String(first));
                })}
                className="space-y-6"
              >
                {/* 1. Category Selection */}
                <Card className="border-border/80 shadow-md">
                  <CardContent className="p-5 space-y-3">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <div>
                            <FormLabel className="text-lg font-semibold flex items-center gap-2">
                              <span>1. What do you want to report?</span>
                              <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormDescription className="text-xs text-muted-foreground">
                              Select the category that best matches your situation
                            </FormDescription>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                            {categories.map((cat) => {
                              const Icon = cat.icon;
                              const isSelected = field.value === cat.value;
                              return (
                                <div
                                  key={cat.value}
                                  onClick={() => {
                                    field.onChange(cat.value);
                                    if (cat.value === 'teacher') {
                                      form.setValue('personType', 'teacher');
                                      setIsAnonymous(false);
                                      form.setValue('isAnonymous', false);
                                    } else {
                                      form.setValue('personType', 'student');
                                    }
                                  }}
                                  className={`cursor-pointer rounded-xl border p-4 transition-all duration-200 flex items-start gap-3 select-none ${
                                    isSelected
                                      ? `${cat.borderActive} ring-2 ring-primary/40 shadow-sm scale-[1.01]`
                                      : 'border-border/70 bg-card hover:bg-muted/40 hover:border-primary/40'
                                  }`}
                                >
                                  <div className={`p-2.5 rounded-lg bg-background border shadow-xs ${cat.color} shrink-0`}>
                                    <Icon className="h-5 w-5" />
                                  </div>
                                  <div className="space-y-1">
                                    <div className="font-semibold text-sm flex items-center gap-1.5">
                                      <span>{cat.label}</span>
                                      {isSelected && <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">Selected</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                      {cat.description}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* 2. Urgency Level Selection */}
                <Card className="border-border/80 shadow-md">
                  <CardContent className="p-5 space-y-3">
                    <FormField
                      control={form.control}
                      name="intensity"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <div>
                            <FormLabel className="text-lg font-semibold flex items-center gap-2">
                              <span>2. How urgent is this?</span>
                              <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormDescription className="text-xs text-muted-foreground">
                              Helps authorities respond with appropriate priority
                            </FormDescription>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                            {intensityLevels.map((lvl) => {
                              const isSelected = field.value === lvl.value;
                              return (
                                <button
                                  type="button"
                                  key={lvl.value}
                                  onClick={() => field.onChange(lvl.value)}
                                  className={`p-3 rounded-xl border text-left transition-all select-none ${
                                    isSelected
                                      ? `${lvl.color} border-current ring-2 ring-primary/30 shadow-xs font-semibold`
                                      : 'border-border/70 bg-card hover:bg-muted/40 text-foreground'
                                  }`}
                                >
                                  <div className="text-sm font-semibold">{lvl.label}</div>
                                  <div className="text-[11px] text-muted-foreground mt-0.5">{lvl.description}</div>
                                </button>
                              );
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* 3. Description Box */}
                <Card className="border-border/80 shadow-md">
                  <CardContent className="p-5 space-y-3">
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                              <FormLabel className="text-lg font-semibold flex items-center gap-2">
                                <span>3. Tell us what happened</span>
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormDescription className="text-xs text-muted-foreground">
                                Describe what occurred, where, and when (minimum 3 characters)
                              </FormDescription>
                            </div>

                            {/* Voice Input Toggle Button */}
                            <Button
                              type="button"
                              variant={isRecording ? 'destructive' : 'outline'}
                              size="sm"
                              onClick={toggleRecording}
                              className="text-xs h-8 gap-1.5 shadow-xs"
                            >
                              <Mic className={`h-3.5 w-3.5 ${isRecording ? 'animate-pulse text-white' : 'text-primary'}`} />
                              <span>{isRecording ? 'Stop Recording' : 'Voice Dictate'}</span>
                            </Button>
                          </div>

                          <FormControl>
                            <Textarea
                              placeholder="Describe your concern here... What happened? Who was involved? Where did it take place?"
                              className="min-h-36 resize-y text-sm leading-relaxed"
                              disabled={isSubmitting}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* 4. CONDITIONAL FIELDS: ONLY APPEAR FOR TEACHER / STAFF */}
                {isTeacherSelected && (
                  <Card className="border-purple-300 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 shadow-md animate-in fade-in duration-300">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-100/70 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-800">
                        <Shield className="h-5 w-5 text-purple-700 dark:text-purple-300 shrink-0 mt-0.5" />
                        <div className="text-xs text-purple-900 dark:text-purple-200 space-y-1">
                          <div className="font-semibold text-sm">🔒 Independent Child Protection Protocol</div>
                          <p>
                            Reports involving school teachers or staff are automatically routed directly to the Central Child Protection Response Board (CCPRB). To guarantee an official legal inquiry, student identity details are required.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Name of Teacher / Staff Involved */}
                        <FormField
                          control={form.control}
                          name="implicatedName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-semibold flex items-center gap-1">
                                <span>Teacher / Staff Name</span>
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="e.g., Mr. Sharma / Math Teacher"
                                  className="bg-background"
                                  disabled={isSubmitting}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Student's Class / Grade */}
                        <FormField
                          control={form.control}
                          name="classroom"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-semibold flex items-center gap-1">
                                <span>Your Class / Section</span>
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="e.g., 9th Grade, Section A"
                                  className="bg-background"
                                  disabled={isSubmitting}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        {/* Student Reporter's Name */}
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-semibold flex items-center gap-1">
                                <span>Your Full Name</span>
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Your full legal / school name"
                                  className="bg-background"
                                  disabled={isSubmitting}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Student / Parent Contact */}
                        <FormField
                          control={form.control}
                          name="contact"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-semibold">
                                Contact (Phone or Email - Optional)
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Parent phone or student email"
                                  className="bg-background"
                                  disabled={isSubmitting}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* 5. CONDITIONAL FIELDS: ONLY APPEAR FOR BULLYING */}
                {isBullyingSelected && !isTeacherSelected && (
                  <Card className="border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 shadow-md animate-in fade-in duration-300">
                    <CardContent className="p-5 space-y-4">
                      <div className="space-y-1">
                        <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                          Bullying Details (Optional)
                        </h4>
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          If you know who is bullying, let us know. You can still submit if you don't know their name.
                        </p>
                      </div>

                      <FormField
                        control={form.control}
                        name="bullyName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">
                              Name of Student(s) Bullying
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g., Student name, grade, or nickname"
                                className="bg-background"
                                disabled={isSubmitting}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* 6. GENERAL IDENTITY & ANONYMOUS TOGGLE (For non-teacher reports) */}
                {!isTeacherSelected && (
                  <Card className="border-border/80 shadow-md">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                            {isAnonymous ? <UserX className="h-5 w-5" /> : <User className="h-5 w-5" />}
                          </div>
                          <div>
                            <div className="font-semibold text-sm">
                              {isAnonymous ? 'Submitting Anonymously' : 'Named Report (Optional)'}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {isAnonymous
                                ? 'Your identity is completely private. No name is attached.'
                                : 'You can provide your details if you would like counselors to follow up with you.'}
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
                        />
                      </div>

                      {/* Optional Name & Class for Named Reports */}
                      {!isAnonymous && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t animate-in fade-in duration-200">
                          <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-sm font-semibold">Your Name (Optional)</FormLabel>
                                <FormControl>
                                  <Input placeholder="Enter your name" disabled={isSubmitting} {...field} />
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
                                <FormLabel className="text-sm font-semibold">Your Class / Grade (Optional)</FormLabel>
                                <FormControl>
                                  <Input placeholder="e.g., 8A, Grade 10" disabled={isSubmitting} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* 7. Additional Context (Optional Location & Age) */}
                <Card className="border-border/80 shadow-md">
                  <CardContent className="p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Specific Location / Spot (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g., 2nd Floor Corridor, Cafeteria, School Bus"
                                disabled={isSubmitting}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="age"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Your Age (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="5"
                                max="25"
                                placeholder="e.g., 14"
                                disabled={isSubmitting}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Security Guarantee Notice */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2.5 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <Shield className="h-4 w-4 text-primary shrink-0" />
                    <span>256-Bit Encrypted & Stored Securely</span>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <Phone className="h-4 w-4 text-destructive shrink-0" />
                    <span>Immediate Emergency: Childline <strong>1098</strong></span>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full text-base font-semibold py-6 shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      <span>Submitting Report...</span>
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-5 w-5" />
                      <span>Submit Report Safely</span>
                    </>
                  )}
                </Button>
              </form>
            </Form>
          )}

          {/* Submission Success Dialog */}
          <Dialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
            <DialogContent className="max-w-md text-center p-6 space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-7 w-7" />
              </div>
              <DialogHeader className="space-y-1">
                <DialogTitle className="text-xl font-bold">Report Received Safely</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Your report has been encrypted and submitted to authorized child safeguarding staff.
                </DialogDescription>
              </DialogHeader>

              <div className="p-4 rounded-xl bg-muted/60 border border-border/80 space-y-1.5">
                <div className="text-xs text-muted-foreground font-medium">Your Confidential Tracking ID:</div>
                <div className="font-mono text-base font-bold text-primary flex items-center justify-center gap-2">
                  <span>{submittedReportId || 'Pending...'}</span>
                  <button
                    type="button"
                    onClick={copyTrackingId}
                    className="p-1 hover:bg-primary/10 rounded transition-colors text-muted-foreground hover:text-primary"
                    title="Copy Tracking ID"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Keep this ID safe if you want to follow up on your report later.
                </p>
              </div>

              <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSuccessModalOpen(false);
                    setReportingMode('booth');
                  }}
                  className="flex-1 text-xs"
                >
                  Return to Phone Booth
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setSuccessModalOpen(false);
                    window.location.href = '/#/';
                  }}
                  className="flex-1 text-xs"
                >
                  Return to Home
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Report;
