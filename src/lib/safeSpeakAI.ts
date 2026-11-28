import { detectHighSeverityKeywords } from './utils';
import { classifyWithOllama } from './ollamaService';

export interface ReportOutput {
    category: string;
    sentiment: string;
    risk_score: number;
    risk_level: "L0" | "L1" | "L2" | "L3";
    route_to: string;
    human_review_required: boolean;
    details: {
        full_emotion_data: {
            primary_emotion: string;
            scores: Record<string, number>;
        };
        rule_triggered: boolean;
        original_text: string;
        source?: 'ollama' | 'local_rules' | 'ai_memory';
        model?: string;
        explanation?: string;
        suggested_action?: string;
        supportive_message?: string;
        detected_feelings?: string[];
    };
}

export function getSupportiveMessageAndFeelings(category: string, risk_level: string): { message: string; feelings: string[] } {
    switch (category) {
        case 'teacher_involved':
            return {
                feelings: ['Scared', 'Intimidated', 'Unfairly Treated'],
                message: "It takes tremendous courage to speak up about a teacher or staff member. You are safe here, and this goes directly to child safety authorities who will protect you.",
            };
        case 'physical_threat':
            return {
                feelings: ['In Danger', 'Afraid', 'Shaken'],
                message: "Your physical safety is our number one priority. We hear you and are immediately alerting trusted protection officers.",
            };
        case 'sexual_abuse':
            return {
                feelings: ['Hurt', 'Violated', 'Unsafe'],
                message: "You did nothing wrong and you are never to blame. We take this report with absolute confidentiality and care.",
            };
        case 'self_harm':
            return {
                feelings: ['Overwhelmed', 'Hopeless', 'Hurting'],
                message: "Your life is precious and you don't have to carry this heavy burden alone. Caring people want to support you right now.",
            };
        case 'bullying':
        case 'cyberbullying':
            return {
                feelings: ['Hurt', 'Left Out', 'Frustrated'],
                message: "Nobody has the right to treat you that way or make you feel small. We hear you and counselors will step in to protect you.",
            };
        case 'academic_pressure':
            return {
                feelings: ['Stressed', 'Exhausted', 'Anxious'],
                message: "Take a deep breath. School pressure can be heavy, but your worth is so much more than grades. Help is here.",
            };
        case 'emotional_distress':
            return {
                feelings: ['Lonely', 'Sad', 'Overwhelmed'],
                message: "Your feelings are completely valid. You don't have to face this alone — we are listening and right beside you.",
            };
        case 'teacher_protector':
            return {
                feelings: ['Relieved', 'Grateful', 'Cared For'],
                message: "We're glad a teacher was there to protect and comfort you. Your report is documented.",
            };
        case 'prank':
            return {
                feelings: ['Playful'],
                message: "SafeSpeak is reserved for student safety and emotional support.",
            };
        default:
            return {
                feelings: ['Concerned', 'Seeking Support'],
                message: "Thank you for expressing your feelings. Your voice matters and our team is reviewing your words with care.",
            };
    }
}

/**
 * Primary AI analysis function for student reports.
 * Uses Ollama LLM in the background when available, with automatic
 * seamless fallback to the local rule & memory engine if Ollama is offline.
 */
export async function analyzeReport(
    text: string,
    options?: { forceLocal?: boolean; model?: string }
): Promise<ReportOutput> {
    if (!text || text.trim().length === 0) {
        return analyzeReportDemo(text);
    }

    if (!options?.forceLocal) {
        try {
            console.log('🤖 Sending complaint to Ollama background AI...');
            const timeoutPromise = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('Ollama response timeout (2s)')), 2000)
            );
            const ollamaResult = await Promise.race([
                classifyWithOllama(text, options?.model),
                timeoutPromise
            ]);

            console.log('✅ Ollama classification received:', ollamaResult);

            return {
                category: ollamaResult.category,
                sentiment: ollamaResult.sentiment,
                risk_score: ollamaResult.risk_score,
                risk_level: ollamaResult.risk_level,
                route_to: ollamaResult.route_to,
                human_review_required: ollamaResult.human_review_required,
                details: {
                    full_emotion_data: {
                        primary_emotion: ollamaResult.sentiment,
                        scores: { severity: ollamaResult.risk_score },
                    },
                    rule_triggered: ollamaResult.is_teacher_involved,
                    original_text: text,
                    source: 'ollama',
                    model: ollamaResult.model,
                    explanation: ollamaResult.explanation,
                    suggested_action: ollamaResult.suggested_action,
                    supportive_message: ollamaResult.supportive_message,
                    detected_feelings: ollamaResult.detected_feelings,
                },
            };
        } catch (ollamaError: any) {
            console.info('ℹ️ Ollama not reachable, using local rule analyzer fallback:', ollamaError?.message || ollamaError);
        }
    }

    // Fallback to local rule and pattern analyzer
    return analyzeReportDemo(text);
}

// Local client-side analyzer (rules + training memory)
export async function analyzeReportDemo(text: string): Promise<ReportOutput> {
    const lowered = (text || '').toLowerCase().trim();

    // 1. Check against Training Data (Simulating Memory & Pattern Learning)
    try {
        const { TRAINING_EXAMPLES } = await import('./trainingData');

        const stopwords = new Set(['i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'is', 'am', 'are', 'was', 'were', 'be', 'a', 'an', 'the', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'of', 'with', 'this', 'that']);
        const getWords = (str: string) => str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
        const inputWords = getWords(lowered);

        let bestMatch: { example: typeof TRAINING_EXAMPLES[0]; score: number } | null = null;

        for (const ex of TRAINING_EXAMPLES) {
            const exLower = ex.text.toLowerCase();
            if (lowered === exLower || (lowered.length >= 10 && lowered.includes(exLower))) {
                bestMatch = { example: ex, score: 1.0 };
                break;
            }

            const exWords = getWords(exLower);
            if (exWords.length > 0 && inputWords.length > 0) {
                const intersection = inputWords.filter(w => exWords.includes(w));
                const union = new Set([...inputWords, ...exWords]);
                const jaccard = intersection.length / union.size;
                if (intersection.length >= 2 && jaccard >= 0.45) {
                    if (!bestMatch || jaccard > bestMatch.score) {
                        bestMatch = { example: ex, score: jaccard };
                    }
                }
            }
        }

        if (bestMatch) {
            const match = bestMatch.example;
            console.log(`AI Memory Match: "${match.text}" -> ${match.category} (score: ${bestMatch.score.toFixed(2)})`);

            let risk_level: ReportOutput['risk_level'] = 'L1';
            let route_to = 'counselor';
            let category: string = match.category;
            let risk_score = 0.8;

            switch (match.category) {
                case 'teacher_bullying':
                    risk_level = 'L3';
                    route_to = 'higher_authority';
                    category = 'teacher_involved';
                    risk_score = 0.95;
                    break;
                case 'physical_abuse':
                case 'safety_threat':
                    risk_level = 'L3';
                    route_to = 'higher_authority';
                    category = 'physical_threat';
                    risk_score = 0.98;
                    break;
                case 'mental_health':
                    risk_level = 'L3';
                    route_to = 'suicide_prevention';
                    category = 'self_harm';
                    risk_score = 0.95;
                    break;
                case 'bullying':
                case 'cyberbullying':
                    risk_level = 'L2';
                    route_to = 'school_counselor';
                    category = 'bullying';
                    risk_score = 0.65;
                    break;
                case 'prank':
                case 'normal_discipline':
                    risk_level = 'L0';
                    route_to = 'filtered';
                    risk_score = 0.1;
                    break;
                case 'emotional_distress':
                case 'academic_pressure':
                    risk_level = 'L1';
                    route_to = 'counselor';
                    risk_score = 0.35;
                    break;
                default:
                    risk_level = 'L1';
                    risk_score = 0.3;
            }

            const comfort = getSupportiveMessageAndFeelings(category, risk_level);

            return {
                category,
                sentiment: risk_level === 'L3' ? 'critical' : risk_level === 'L2' ? 'serious' : 'neutral',
                risk_score,
                risk_level,
                route_to,
                human_review_required: risk_level !== 'L0',
                details: {
                    full_emotion_data: { primary_emotion: 'analyzed', scores: {} },
                    rule_triggered: true,
                    original_text: text,
                    source: 'ai_memory',
                    supportive_message: comfort.message,
                    detected_feelings: comfort.feelings,
                }
            };
        }
    } catch (e) {
        console.warn('Failed to evaluate training memory, falling back to rules:', e);
    }

    // 2. Context-aware Rule Engine
    const kw = detectHighSeverityKeywords(lowered);

    let risk_level: ReportOutput['risk_level'] = 'L0';
    let route_to = 'triage';
    let risk_score = 0.0;
    let category = 'other';

    if (kw.matched) {
        switch (kw.patternId) {
            case 'teacher_involved':
                risk_level = 'L3';
                route_to = 'higher_authority';
                risk_score = 0.95;
                category = 'teacher_involved';
                break;
            case 'physical_threat':
                risk_level = 'L3';
                route_to = 'higher_authority';
                risk_score = 0.96;
                category = 'physical_threat';
                break;
            case 'sexual_abuse':
                risk_level = 'L3';
                route_to = 'higher_authority';
                risk_score = 0.97;
                category = 'sexual_abuse';
                break;
            case 'self_harm':
                risk_level = 'L3';
                route_to = 'suicide_prevention';
                risk_score = 0.98;
                category = 'self_harm';
                break;
            case 'teacher_protector':
                risk_level = 'L1';
                route_to = 'counselor_review';
                risk_score = 0.15;
                category = 'teacher_protector';
                break;
            case 'teacher_mentioned':
                risk_level = 'L1';
                route_to = 'counselor_review';
                risk_score = 0.25;
                category = 'general_staff_mention';
                break;
            default:
                risk_level = 'L2';
                route_to = 'counselor_review';
                risk_score = 0.5;
                category = kw.reason || 'other';
        }
    } else if (/\b(bully|bullied|bullying|harass|harassing|harassed|tease|teasing|rumor|rumors|mock|mocking|threat|threatened|punched|kicked|insult|insulting)\b/i.test(lowered)) {
        risk_level = 'L2';
        route_to = 'school_counselor';
        risk_score = 0.65;
        category = 'bullying';
    } else if (/\b(sad|depressed|cry|crying|anxious|anxiety|stress|stressed|scared|lonely|alone|afraid|pressure|fail|failing)\b/i.test(lowered)) {
        risk_level = 'L1';
        route_to = 'counselor_review';
        risk_score = 0.35;
        category = 'emotional_distress';
    } else if (/\b(joke|kidding|lol|haha|prank|test|asdf)\b/i.test(lowered)) {
        risk_level = 'L0';
        route_to = 'filtered';
        risk_score = 0.05;
        category = 'prank';
    } else {
        risk_level = 'L1';
        route_to = 'counselor_review';
        risk_score = 0.2;
        category = 'other';
    }

    const comfort = getSupportiveMessageAndFeelings(category, risk_level);

    return {
        category,
        sentiment: risk_level === 'L3' ? 'critical' : risk_level === 'L2' ? 'serious' : 'neutral',
        risk_score,
        risk_level,
        route_to,
        human_review_required: risk_level !== 'L0',
        details: {
            full_emotion_data: {
                primary_emotion: risk_level === 'L3' ? 'distress' : 'neutral',
                scores: {},
            },
            rule_triggered: true,
            original_text: text,
            source: 'local_rules',
            supportive_message: comfort.message,
            detected_feelings: comfort.feelings,
        }
    };
}
