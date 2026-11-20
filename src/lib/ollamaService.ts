export interface OllamaClassificationResult {
  category: string;
  sentiment: string;
  risk_score: number;
  risk_level: "L0" | "L1" | "L2" | "L3";
  route_to: string;
  is_teacher_involved: boolean;
  human_review_required: boolean;
  explanation: string;
  suggested_action: string;
  supportive_message: string;
  detected_feelings: string[];
  model: string;
}

export interface OllamaStatus {
  available: boolean;
  models: string[];
  selectedModel: string;
  endpoint: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 12000;
const FALLBACK_MODELS = ['llama3.2:1b', 'llama3.2', 'qwen2.5:1.5b', 'mistral', 'phi3', 'gemma2:2b', 'llama3'];

export function getCustomOllamaHost(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('safespeak_ollama_host');
  } catch (e) {
    return null;
  }
}

export function setCustomOllamaHost(host: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!host || host.trim() === '') {
      localStorage.removeItem('safespeak_ollama_host');
    } else {
      let formatted = host.trim();
      if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
        formatted = `http://${formatted}`;
      }
      formatted = formatted.replace(/\/+$/, '');
      localStorage.setItem('safespeak_ollama_host', formatted);
    }
  } catch (e) {
    console.error('Failed to set custom Ollama host:', e);
  }
}

export function getOllamaBaseUrl(): string {
  // 1. Check custom host configured by user/admin in browser/app
  const custom = getCustomOllamaHost();
  if (custom) return custom;

  // 2. Check environment variable (configured during build or in .env)
  const env = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || {};
  if (env.VITE_OLLAMA_URL) return env.VITE_OLLAMA_URL;

  // 3. In Vite development, use proxy to eliminate CORS
  if (typeof window !== 'undefined' && env.DEV) {
    return '/api/ollama';
  }

  return 'http://127.0.0.1:11434';
}

export function getDefaultModel(): string {
  const env = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || {};
  return env.VITE_OLLAMA_MODEL || 'llama3.2:1b';
}

/**
 * Pings any Ollama endpoint to verify connectivity without saving it.
 */
export async function testOllamaHost(endpoint: string): Promise<{ success: boolean; models: string[]; selectedModel?: string; error?: string }> {
  let target = endpoint.trim();
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    target = `http://${target}`;
  }
  target = target.replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${target}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { success: false, models: [], error: `Server returned HTTP ${res.status}` };
    }

    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => m.name || m.model).filter(Boolean)
      : [];

    return {
      success: true,
      models,
      selectedModel: models.length > 0 ? models[0] : 'llama3.2:1b',
    };
  } catch (err: any) {
    return {
      success: false,
      models: [],
      error: err?.name === 'AbortError' ? 'Connection timed out (Check IP/Port/Firewall)' : (err?.message || 'Host unreachable'),
    };
  }
}

/**
 * Checks if Ollama background server is running and returns available models.
 */
export async function checkOllamaStatus(): Promise<OllamaStatus> {
  const baseUrl = getOllamaBaseUrl();
  const configuredModel = getDefaultModel();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        available: false,
        models: [],
        selectedModel: configuredModel,
        endpoint: baseUrl,
        error: `Ollama responded with status ${res.status}`,
      };
    }

    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => m.name || m.model).filter(Boolean)
      : [];

    let selectedModel = configuredModel;
    if (models.length > 0) {
      // If configured model is in the list, use it; otherwise pick best available match
      const matched = models.find((m: string) => m.toLowerCase().includes(configuredModel.toLowerCase()));
      selectedModel = matched || models[0];
    }

    return {
      available: true,
      models,
      selectedModel,
      endpoint: baseUrl,
    };
  } catch (err: any) {
    return {
      available: false,
      models: [],
      selectedModel: configuredModel,
      endpoint: baseUrl,
      error: err?.message || 'Ollama server not reachable',
    };
  }
}

/**
 * Classifies a student complaint using Ollama LLM.
 * Returns structured classification matching SafeSpeak's safety taxonomy.
 */
export async function classifyWithOllama(
  text: string,
  modelOverride?: string
): Promise<OllamaClassificationResult> {
  const baseUrl = getOllamaBaseUrl();
  const model = modelOverride || getDefaultModel();

  const prompt = `You are the AI Safety Classifier for SafeSpeak, an anonymous reporting app for school students.
Analyze this student complaint carefully:
"${text}"

Categories allowed:
- "teacher_involved": A teacher, principal, tutor, or school staff member is accused of abuse, harassment, physical punishment, threats, humiliation, or inappropriate conduct.
- "physical_threat": Physical violence, weapons (knives, guns), fights, severe battery, assaults.
- "sexual_abuse": Inappropriate touching, sexual harassment, predatory behavior, exploitation.
- "self_harm": Suicidal thoughts, self-injury, "want to die", severe mental health crisis.
- "bullying": Peer harassment, name-calling, rumors, exclusion, physical pushing by classmates, cyberbullying.
- "academic_pressure": Severe exam anxiety, extreme homework distress, parental pressure over grades.
- "emotional_distress": Loneliness, grief, isolation, depression, sadness without immediate suicide intent.
- "normal_discipline": Reasonable, non-abusive teacher discipline (e.g. asking class to be quiet, strict homework checks).
- "prank": Obvious joke, test message, playful gibberish, spam.
- "other": General student feedback or unspecified concerns.

Risk Levels:
- "L3": Critical / Emergency. Immediate danger, any teacher misconduct/harm, weapons, sexual abuse, self-harm.
- "L2": Moderate / Serious. Ongoing bullying, cyberbullying, severe distress.
- "L1": Low. Mild distress, academic concerns, protector mentions, monitoring needed.
- "L0": Harmless. Normal discipline, jokes, pranks, gibberish.

Routing targets:
- "higher_authority": Teacher misconduct or critical threats requiring external board review.
- "principal": Urgent on-campus physical threat.
- "school_counselor": Bullying, peer conflict, academic pressure.
- "suicide_prevention": Self harm / suicide crisis.
- "counselor_review": Low risk / general review.
- "filtered": Prank / dismiss.

Respond strictly with valid JSON with keys:
{
  "category": "string",
  "risk_level": "L0" | "L1" | "L2" | "L3",
  "risk_score": float between 0.0 and 1.0,
  "sentiment": "critical" | "serious" | "distressed" | "neutral",
  "route_to": "string",
  "is_teacher_involved": boolean,
  "human_review_required": boolean,
  "explanation": "concise 1-2 sentence reason",
  "suggested_action": "brief action advice",
  "supportive_message": "warm, compassionate 1-2 sentence reassurance directly to the student",
  "detected_feelings": ["Scared", "Sad", "Overwhelmed", etc.]
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1, // Deterministic, reliable classifications
          top_p: 0.9,
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const rawResponse = data?.response;
    if (!rawResponse) {
      throw new Error('Ollama returned empty response');
    }

    const parsed = JSON.parse(rawResponse);

    // Validate and sanitize response
    const validLevels = ['L0', 'L1', 'L2', 'L3'];
    let risk_level = (validLevels.includes(parsed.risk_level) ? parsed.risk_level : 'L1') as "L0" | "L1" | "L2" | "L3";
    let is_teacher_involved = Boolean(parsed.is_teacher_involved);
    let category = parsed.category || 'other';
    let route_to = parsed.route_to || 'counselor_review';

    // Safety guardrail: if teacher is involved in harm, force L3 and higher_authority
    if (category === 'teacher_involved' || is_teacher_involved) {
      is_teacher_involved = true;
      category = 'teacher_involved';
      risk_level = 'L3';
      route_to = 'higher_authority';
    }

    const feelings = Array.isArray(parsed.detected_feelings)
      ? parsed.detected_feelings.slice(0, 4)
      : ['Heard', 'Supported'];

    return {
      category,
      risk_level,
      risk_score: typeof parsed.risk_score === 'number' ? Math.min(1.0, Math.max(0.0, parsed.risk_score)) : 0.75,
      sentiment: parsed.sentiment || (risk_level === 'L3' ? 'critical' : 'serious'),
      route_to,
      is_teacher_involved,
      human_review_required: parsed.human_review_required !== undefined ? parsed.human_review_required : risk_level !== 'L0',
      explanation: parsed.explanation || 'Analyzed with Ollama AI.',
      suggested_action: parsed.suggested_action || 'Follow standard triage protocols.',
      supportive_message: parsed.supportive_message || 'Thank you for sharing your feelings. You are safe here and help is on the way.',
      detected_feelings: feelings,
      model,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}
