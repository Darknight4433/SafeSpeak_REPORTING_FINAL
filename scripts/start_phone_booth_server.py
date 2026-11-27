#!/usr/bin/env python3
"""
========================================================================================
SafeSpeak Phone Booth - Phase 3 AI Voice Engine (RTX 3050 6GB)
========================================================================================
Features:
1. Low-Latency Streaming LLM: Streams tokens from Qwen 2.5 7B via Ollama.
2. Real-Time Sentence Chunking: Emits spoken sentences the moment punctuation is reached
   so the client kiosk begins TTS playback with near-zero latency (<500ms).
3. Barge-In Interruption Support: Handles student interruption packets to halt generation.
4. Child Safeguarding Prompts: No false promises, clear AI identity, voluntary disclosure.
5. Dual STT Pipeline: WebSpeech client events + raw audio buffer transcription fallback.
6. Progressive Background Slot Extraction: Assembles incident details asynchronously.
========================================================================================
"""

import os
import sys
import re
import json
import time
import socket
import shutil
import subprocess
import asyncio
import threading
import base64
import urllib.request
import urllib.error

# ElevenLabs HD Voice Configuration with 4-Key Rotation
ELEVEN_LABS_KEYS = [
    "sk_8fde097b04c48a06ce5631baed05ea4dc4b9ea69df463597",
    "sk_ca770c72b95cb453420917026a970f32dd2ff2fc57c1b551",
    "sk_0a20833dd98773b18282f07fb2da25ea1ef68e68b1b43e6e",
    "sk_f017c44fdd87a3f70b6c1b4e18bca9634185b96b8964063a"
]
ELEVEN_LABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"  # Sarah (Mature, Reassuring, Confident - Premade Free Tier)
current_eleven_key_idx = 0

def synthesize_local_edge_tts_b64(text: str, language: str = "en"):
    """
    High-fidelity neural voice synthesis via edge-tts.
    - Malayalam: ml-IN-SobhanaNeural (Warm, caring, native Kerala Malayalam)
    - English: en-IN-NeerjaExpressiveNeural (Warm, natural, school-friendly conversational English)
    """
    try:
        import edge_tts
        clean_text = re.sub(r'[*_#`~]', '', text).strip()
        if not clean_text:
            return None
        
        has_ml_chars = bool(re.search(r'[\u0d00-\u0d7f]', clean_text))
        voice = "ml-IN-SobhanaNeural" if (has_ml_chars or language == "ml") else "en-IN-NeerjaExpressiveNeural"

        async def _gen():
            communicate = edge_tts.Communicate(clean_text, voice, rate="-2%", pitch="+1Hz")
            chunks = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    chunks.append(chunk["data"])
            return b"".join(chunks)

        loop = asyncio.new_event_loop()
        try:
            audio_bytes = loop.run_until_complete(_gen())
            if audio_bytes:
                return base64.b64encode(audio_bytes).decode("ascii")
        finally:
            loop.close()
    except Exception as e:
        print(f"⚠️ edge-tts primary synthesis error: {e}")
        try:
            import edge_tts
            fallback_voice = "ml-IN-SobhanaNeural" if (language == "ml") else "en-US-JennyNeural"
            communicate = edge_tts.Communicate(clean_text, fallback_voice)
            chunks = []
            loop = asyncio.new_event_loop()
            try:
                async def _gen2():
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            chunks.append(chunk["data"])
                    return b"".join(chunks)
                audio_bytes = loop.run_until_complete(_gen2())
                if audio_bytes:
                    return base64.b64encode(audio_bytes).decode("ascii")
            finally:
                loop.close()
        except Exception:
            pass
    return None

def synthesize_elevenlabs_b64(text: str, language: str = "en"):
    """
    Synthesizes natural, high-fidelity neural voice.
    Uses edge-tts directly (ml-IN-SobhanaNeural for Malayalam, en-IN-NeerjaExpressiveNeural for English)
    providing studio-quality, human-warmth speech without quota limits or robotic artifacts.
    """
    if not text or not text.strip():
        return None
    clean_text = re.sub(r'[*_#`~]', '', text).strip()
    return synthesize_local_edge_tts_b64(clean_text, language)

# Local Speech Recognition using faster-whisper (Base model, 100% offline & unlimited)
whisper_model = None
def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        try:
            import faster_whisper
            print("🚀 Loading Local Whisper STT model (base, CPU int8)...")
            whisper_model = faster_whisper.WhisperModel("base", device="cpu", compute_type="int8")
            print("✅ Local Whisper STT model ready for zero-latency offline transcription!")
        except Exception as e:
            print(f"⚠️ Could not load local faster_whisper model: {e}")
            whisper_model = False
    return whisper_model if whisper_model is not False else None

def transcribe_local_whisper_bytes(audio_bytes: bytes, language: str = None) -> str | None:
    """Transcribes audio 100% locally on laptop using Whisper without external keys or limits."""
    if not audio_bytes or len(audio_bytes) < 400:
        return None
    model = get_whisper_model()
    if not model:
        return None
    try:
        import io
        audio_stream = io.BytesIO(audio_bytes)
        # Transcribe audio buffer
        lang_code = "ml" if language == "ml" else None
        segments, _ = model.transcribe(
            audio_stream,
            beam_size=1,
            language=lang_code,
            condition_on_previous_text=False
        )
        full_text = " ".join([seg.text.strip() for seg in segments if seg.text]).strip()
        clean_text = re.sub(r'\[.*?\]', '', full_text).strip()
        if clean_text:
            print(f"🎙️ [Local Whisper STT] Transcribed: \"{clean_text}\"")
            return clean_text
        return ""
    except Exception as e:
        print(f"⚠️ Local Whisper transcription error: {e}")
        return None

def transcribe_audio_bytes(audio_bytes: bytes, language: str = None) -> str | None:
    """Zero-quota, reliable speech-to-text pipeline."""
    # 1. Primary: 100% Local Whisper STT (instant, unlimited, no 401 errors)
    text = transcribe_local_whisper_bytes(audio_bytes, language)
    if text is not None:
        return text
    return ""

# Server Configuration
OLLAMA_HOST = os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("SAFESPEAK_MODEL", "llama3.2:3b")
TARGET_MODELS = [DEFAULT_MODEL, "llama3.2:3b", "qwen2.5:3b", "llama3.2:1b", "qwen2.5:1.5b"]
WS_PORT = int(os.environ.get("SAFESPEAK_WS_PORT", 8765))

# Safeguarding Conversational Persona Prompt (Emotionally Intelligent, Spoken Voice Mode)
CONVERSATIONAL_SYSTEM_PROMPT = """You are SafeSpeak AI, an emotionally intelligent, warm, gentle, and deeply caring companion in a school safety phone booth (similar to ChatGPT Voice mode).
A child/student is speaking to you over a telephone handset.

CORE CONVERSATIONAL SAFEGUARDING LOGIC:
1. NATURAL & GENTLE CONVERSATION:
   - Talk naturally, gently, and warmly. You are a safe, caring presence.
   - Ask relevant, thoughtful follow-up questions to understand the problem (e.g. what happened, who was involved, or where it happened).
   - Continue the conversation until you understand the situation sufficiently to prepare a safe report.
   - Never repeatedly question, pressure, interrogate, or drill the child. Never ask multiple questions at once.

2. CHILD'S COMFORT AND BOUNDARIES (ABSOLUTE RULE):
   - If the child says they don't want to explain further, say "I don't know", feel uncomfortable, or want to stop: NEVER pry deeper.
   - Immediately respect the child's decision and stop asking further questions.
   - Reassure them: "That is completely okay. You don't have to explain anything more. Thank you for telling me what you did."
   - Prepare the report using only the information the child has voluntarily communicated.

3. SPOKEN VOICE OUTPUT:
   - Write ONLY 1 to 2 warm, natural spoken English sentences (15 to 30 words max).
   - NEVER use emojis, markdown, asterisks, bullet points, or stage directions.

4. HONEST ABOUT PRIVACY:
   - Never make false promises like "nobody will ever know" or "100% secret".
   - If asked about privacy, reassure them gently: "Caring school counselors review this so we can support and protect you."

5. NATURAL CONCLUSION:
   - When you have sufficient information to prepare a report, or when the child indicates they want to stop (e.g. "goodbye", "bye", "that's all", "I'm done", "thank you bye"):
     Acknowledge warmly: "Thank you for sharing this with me. Your report has been noted safely, and you did wonderfully by speaking up today. Take care, and goodbye!"
"""

EXTRACTION_SYSTEM_PROMPT = """You are the SafeSpeak Safeguarding Data Analyst.
Extract structured safeguarding facts from the student-AI conversation transcript into the official JSON schema and determine the appropriate reporting pathway.

CRITICAL RULES:
1. ONLY extract information directly and voluntarily stated by the child. NEVER assume, guess, or hallucinate facts.
2. If the child did not mention an item, return null for that field.
3. DETERMINE THE ESCALATION PATHWAY:
   - "higher_authority": If the incident involves a teacher, school staff member, principal, illegal substance/drug dealing, weapon, or critical immediate danger.
   - "normal": For peer disputes, standard student bullying, facility safety concerns, or academic stress.

Respond ONLY with valid JSON matching this schema:
{
  "identity": {
    "name": string or null,
    "name_provided": boolean,
    "anonymous_preference": "undecided" | "anonymous" | "named",
    "identity_confirmation": "confirmed" | "not_confirmed"
  },
  "incident": {
    "category": "bullying" | "teacher_involved" | "abuse" | "substance_abuse" | "academic" | "safety" | "other",
    "description": string,
    "frequency": "repeated" | "one_time" | "unknown",
    "location": string or null,
    "time_context": string or null
  },
  "implicated_person": string or null,
  "substance_involved": string or null,
  "target_population": string or null,
  "child_preferences": {
    "wants_anonymity": boolean or null,
    "wants_to_continue": boolean,
    "preferred_support_person": string or null
  },
  "escalation_decision": {
    "reporting_pathway": "normal" | "higher_authority",
    "reason": string
  },
  "safety_flags": {
    "urgent_review": boolean,
    "human_review_required": boolean
  },
  "detected_emotion": string,
  "severity_level": "L0" | "L1" | "L2" | "L3",
  "summary": "1-2 sentence objective factual summary"
}
"""

def get_lan_ip():
    """Detects local LAN IPv4 address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def check_nvidia_gpu():
    """Checks for NVIDIA RTX 3050 GPU via nvidia-smi."""
    print("\n🔍 Checking NVIDIA GPU status...")
    if not shutil.which("nvidia-smi"):
        print("ℹ️  nvidia-smi not in PATH. Ollama will auto-detect CUDA/VRAM.")
        return False, "Unknown"

    try:
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
            encoding="utf-8"
        )
        lines = [l.strip() for l in output.strip().splitlines() if l.strip()]
        if lines:
            gpu_info = lines[0].split(',')
            name = gpu_info[0].strip()
            total_mb = gpu_info[1].strip()
            free_mb = gpu_info[2].strip()
            print(f"✅ Detected GPU: {name}")
            print(f"   VRAM: {free_mb} MB free / {total_mb} MB total")
            return True, name
    except Exception as e:
        print(f"⚠️ Could not query nvidia-smi: {e}")
    return False, "Unknown"

def is_ollama_running():
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags", headers={"User-Agent": "SafeSpeak-Server"})
        with urllib.request.urlopen(req, timeout=3) as res:
            if res.status == 200:
                data = json.loads(res.read().decode())
                return True, [m.get("name", "") for m in data.get("models", [])]
    except Exception:
        pass
    return False, []

def start_ollama_service():
    """Ensures Ollama is running bound to 0.0.0.0:11434 with CORS enabled."""
    running, models = is_ollama_running()
    if running:
        print("✅ Ollama is already active on", OLLAMA_HOST)
        return True, models

    print("🚀 Starting Ollama background server with 0.0.0.0 binding...")
    env = os.environ.copy()
    env["OLLAMA_HOST"] = "0.0.0.0:11434"
    env["OLLAMA_ORIGINS"] = "*"

    if shutil.which("ollama"):
        try:
            if sys.platform == "win32":
                subprocess.Popen(["cmd.exe", "/c", "set OLLAMA_HOST=0.0.0.0:11434&& set OLLAMA_ORIGINS=*&& ollama serve"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
            else:
                subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
            
            for _ in range(8):
                time.sleep(1.0)
                running, models = is_ollama_running()
                if running:
                    print("✅ Ollama successfully started on 0.0.0.0:11434!")
                    return True, models
        except Exception as e:
            print(f"⚠️ Error launching Ollama: {e}")
    else:
        print("ℹ️  'ollama' CLI not in PATH. SafeSpeak will run in Resilient Zero-Dependency Mode.")

    return False, []

def select_best_model(available_models):
    """Picks the best available lightweight model or pulls target."""
    for target in TARGET_MODELS:
        for m in available_models:
            if target in m:
                print(f"✅ Found active model: {m}")
                return m

    # If none found, pull the recommended fast model
    pull_target = TARGET_MODELS[0]
    print(f"\n📦 Recommended fast model '{pull_target}' not found. Downloading via Ollama...")
    print(f"   (Ultra-low latency model ~2.0 GB: instant voice replies at 100+ tokens/sec, ~2.4GB VRAM)")
    try:
        subprocess.run(["ollama", "pull", pull_target], check=True)
        return pull_target
    except Exception as e:
        print(f"⚠️ Failed to pull '{pull_target}': {e}. Trying lightweight fallback...")
        fallback = "llama3.2:1b"
        try:
            subprocess.run(["ollama", "pull", fallback], check=True)
            return fallback
        except Exception as e2:
            print(f"❌ Fallback pull failed: {e2}")
            return None

def generate_safespeak_empathy_sentences(conversation_history, session_language="en"):
    """
    Intelligent child safeguarding dialog engine following the 3 Safeguarding Phases.
    Provides instant, zero-latency empathetic spoken responses without external LLM dependencies,
    with native bilingual English and grammatically pristine Kerala Malayalam support.
    """
    user_turns = [msg.get("content", "").strip() for msg in conversation_history if msg.get("role") == "user"]
    if not user_turns:
        if session_language == "ml":
            return ["ഹലോ! ഞാൻ കേൾക്കാൻ ഇവിടെയുണ്ട്. വിഷമിക്കേണ്ട, എന്താണ് ഉണ്ടായതെന്ന് സാവധാനം പറയാമോ?"]
        return ["Hi. I'm here to listen. You can tell me anything that's been bothering you, at your own pace."]
    
    last_text = user_turns[-1].lower()
    full_text = " ".join(user_turns).lower()

    # Malayalam dialog branch
    if session_language == "ml" or bool(re.search(r'[\u0d00-\u0d7f]', last_text)):
        # Departure / goodbye
        if re.search(r'\b(വിട|ബൈ|മതി|തീർന്നു|ഇത്രയേ ഉള്ളൂ|പോവുകയാണ്|goodbye|bye|that\'s all|thats all)\b', last_text):
            return ["നിങ്ങൾ പറഞ്ഞ കാര്യങ്ങൾ ഞാൻ സുരക്ഷിതമായി കൗൺസിലർമാർക്ക് കൈമാറിയിട്ടുണ്ട്.", "ധൈര്യത്തോടെ സംസാരിച്ചതിന് ഒത്തിരി നന്ദി. സൂക്ഷ്മതയോടെ പോകുക, ഗുഡ്ബൈ!"]
        
        # Language selection turn (e.g. "Malayalam I like to talk in Malayalam", "മലയാളം")
        if re.search(r'\b(malayalam|മലയാളം|മലയാളത്തിൽ|സംസാരിക്കാം|talk in malayalam|speak in malayalam|like to talk in malayalam)\b', last_text):
            return [
                "ശരി, നമുക്ക് മലയാളത്തിൽ സംസാരിക്കാം.",
                "വിഷമിക്കേണ്ട, എന്താണ് ഉണ്ടായതെന്ന് സാവധാനം പറയാമോ?"
            ]

        # Teacher / Staff misconduct
        if re.search(r'\b(ടീച്ചർ|മാഷ്|സാർ|ടീച്ചറെ|പ്രിൻസിപ്പൽ|staff|teacher|sir)\b', last_text):
            return [
                "വിഷമിക്കേണ്ട, നിങ്ങൾ പറഞ്ഞത് ഞാൻ അതീവ രഹസ്യമായി രേഖപ്പെടുത്താം.",
                "ടീച്ചർ എന്താണ് ചെയ്തത് എന്ന് കൂടുതൽ പറയാമോ?"
            ]

        # Bullying / Physical harm
        if re.search(r'\b(തല്ലി|അടിച്ചു|തള്ളി|കളിയാക്കി|ഭീഷണി|കരഞ്ഞു|bullying|bully|hit|beat|push|hurt)\b', last_text):
            return [
                "ആരും നിങ്ങളെ വേദനിപ്പിക്കാൻ പാടില്ല, നിങ്ങൾ ഇത് തുറന്നു പറഞ്ഞത് വളരെ നല്ല കാര്യമാണ്.",
                "ഇത് സ്കൂളിൽ എവിടെ വെച്ചാണ് സംഭവിച്ചത്?"
            ]

        # Location mentioned (ക്ലാസ്സ്, ഗ്രൗണ്ട്, ബസ്, ഗേറ്റ്, ബാത്റൂം)
        if re.search(r'\b(ക്ലാസ്|ക്ലാസ്സ്|ഗ്രൗണ്ട്|ബസ്|ബസ്സ്|ഗേറ്റ്|ബാത്റൂം|ടോയ്‌ലറ്റ്|ലൈബ്രറി|കാന്റീൻ|class|ground|bus|gate)\b', last_text):
            return [
                "ശരി, ഞാൻ ആ സ്ഥലം കുറിച്ചുവെച്ചിട്ടുണ്ട്.",
                "നിങ്ങളുടെ പേര് ഇതിൽ ചേർക്കണോ, അതോ രഹസ്യമായി വെക്കണമോ?"
            ]

        # Name provided
        if re.search(r'(?:എന്റെ പേര്|പേര്|name is|i am)\s+([^\s]+)', last_text):
            return [
                "പേര് പറഞ്ഞതിന് നന്ദി. ഇത് സ്കൂളിലെ കൗൺസിലർമാർക്ക് മാത്രമേ അറിയാൻ കഴിയൂ.",
                "കൂടുതൽ എന്തെങ്കിലും പറയാനുണ്ടോ, അതോ കോൾ അവസാനിപ്പിക്കണമോ?"
            ]

        # Anonymity preference
        if re.search(r'\b(രഹസ്യം|പേര് പറയണ്ട|പേര് വേണ്ട|anonymous|secret|private|no name)\b', last_text):
            return [
                "തീർച്ചയായും, നിങ്ങളുടെ പേര് പൂർണ്ണമായും രഹസ്യമായി സൂക്ഷിക്കും.",
                "മറ്റെന്തെങ്കിലും കൗൺസിലർമാരെ അറിയിക്കാനുണ്ടോ?"
            ]

        # First turns inquiry
        if len(user_turns) <= 2:
            return ["ഞാൻ ശ്രദ്ധയോടെ കേൾക്കുന്നുണ്ട്.", "എന്ത് കാര്യമാണ് നിങ്ങളെ വിഷമിപ്പിക്കുന്നത്?"]

        return ["നിങ്ങൾ പറഞ്ഞത് ഞാൻ ശ്രദ്ധയോടെ കുറിച്ചെടുത്തിട്ടുണ്ട്.", "കൂടുതൽ എന്തെങ്കിലും പറയാനുണ്ടോ, അതോ കോൾ അവസാനിപ്പിക്കണമോ?"]

    # English language selection turn
    if re.search(r'\b(english|talk in english|speak in english|like to talk in english)\b', last_text):
        return [
            "Sure, we can talk in English.",
            "Take your time, what would you like to share?"
        ]

    # Phase 4: Goodbye / Call Conclusion
    if re.search(r'\b(goodbye|good bye|bye|bye bye|that\'s all|thats all|i\'m done|im done|thank you bye|hang up|end call|that is all|nothing else|see you|got to go|have to go|done now|finish|no more|ready to finish)\b', last_text):
        return ["Thank you for sharing this with me.", "Your report has been safely noted for our counselors, and you did wonderfully by speaking up today. Take care, and goodbye!"]

    # Check if name was already provided anywhere in full conversation
    name_in_full = re.search(r'\b(?:my name is|i am|i\'m|call me|name is)\s+([a-zA-Z]+)\b', full_text)
    child_name = name_in_full.group(1).capitalize() if name_in_full else None

    # Check if student just stated their name
    name_in_last = re.search(r'\b(?:my name is|i am|i\'m|call me|name is)\s+([a-zA-Z]+)\b', last_text)
    if name_in_last:
        name = name_in_last.group(1).capitalize()
        return [f"Thank you for sharing your name, {name}. I have noted that for the counselors.", "Is there anything else you would like to tell me before we finish?"]

    # If student confirmed sharing name or confirmed anonymity
    if re.search(r'\b(yes|share it|share my name|with the counselors|share with counselors|prefer to share|i told that|i just told that)\b', last_text):
        return ["Thank you for letting me know. I have recorded that for the counselors.", "Is there anything else you would like to share, or are you ready to finish?"]

    # Anonymity decision
    if re.search(r'\b(anonymous|stay anonymous|don\'t tell|dont tell|secret|private|no name|don\'t share my name|keep it anonymous)\b', last_text):
        return ["I understand completely.", "We will keep this report anonymous, and our school counselors will look into it without identifying you. Is there anything else you need?"]

    # Teacher / Staff involved
    if re.search(r'\b(teacher|sir|madam|miss|coach|principal|staff|adult)\b', last_text):
        return ["Thank you for sharing that with me. What you're experiencing is taken very seriously.", "Is there a counselor or another adult you feel comfortable talking to as well?"]

    # Location / classroom mentioned
    if re.search(r'\b(lunch|class|classroom|hallway|hall|bathroom|bus|playground|yard|after school|cafeteria|grade)\b', last_text):
        if not child_name:
            return ["I've noted that detail.", "Would you prefer to share your name with our counselors, or make this report anonymously?"]
        else:
            return ["I have safely noted that detail.", "Is there anything else that happened that you would like to mention?"]

    # Bullying / Peer Concern
    if re.search(r'\b(bully|bullied|bullying|hit|push|pushed|tease|teasing|laugh|laughed|mean|mock|scared|hurting|upset|trouble)\b', last_text):
        if re.search(r'\b(repeat|repeating|keeps|always|every day|everyday|again)\b', full_text):
            return ["I am so sorry you are having to deal with that. It is completely unfair that this keeps happening.", "Does this usually happen at school, online, or somewhere else?"]
        else:
            return ["I am so sorry someone has been treating you that way. You did the right thing by speaking up today.", "Has this been happening repeatedly, or was it something that happened today?"]

    # General gentle inquiry
    if len(user_turns) <= 2:
        return ["I hear you, and I am listening carefully.", "Has this been bothering you for a while?"]
    elif not child_name:
        return ["Thank you for trusting me with this.", "Would you prefer to share your name on this report, or keep it anonymous?"]
    else:
        return ["I have noted what you told me.", "Is there anything else on your mind, or would you like to finish the call?"]

def generate_structured_report_offline(conversation_history):
    """Generates comprehensive structured report JSON matching the official schema fast & accurately."""
    LANGUAGE_CHOICE_PATTERN = r'\b(malayalam|english|hindi|tamil|മലയാളം|ഇംഗ്ലീഷ്|talk in malayalam|speak in malayalam|talk in english|speak in english|like to talk in malayalam|like to talk in english)\b'

    incident_user_turns = []
    for msg in conversation_history:
        if msg.get("role") == "user":
            txt = msg.get("content", "").strip()
            cleaned = re.sub(LANGUAGE_CHOICE_PATTERN, '', txt, flags=re.IGNORECASE).strip()
            if cleaned.lower() not in ('', 'i', 'i like to', 'i prefer', 'please', 'i want to'):
                incident_user_turns.append(txt)

    if not incident_user_turns:
        return {
            "category": "safety",
            "severity_level": "L1",
            "location": None,
            "incident_timeframe": None,
            "implicated_person": None,
            "witnesses_present": None,
            "target_population": None,
            "substance_involved": None,
            "safeguarding_recommendations": None,
            "physical_harm_indicated": False,
            "immediate_danger": False,
            "is_ongoing": False,
            "summary": "Call in progress — awaiting incident details",
            "is_escalation_required": False,
            "detected_emotion": "Listening",
            "identity": {
                "name": None,
                "name_provided": False,
                "anonymous_preference": "undecided",
                "identity_confirmation": "not_confirmed"
            },
            "incident": {
                "category": "safety",
                "description": "Call in progress — awaiting incident details",
                "frequency": "unknown",
                "location": None,
                "time_context": None,
                "implicated_person": None,
                "witnesses_present": None
            },
            "child_preferences": {
                "wants_anonymity": None,
                "wants_to_continue": True,
                "preferred_support_person": None
            },
            "support_needs": {
                "requested_help": None,
                "concerns": []
            },
            "safety_flags": {
                "urgent_review": False,
                "immediate_danger": False,
                "physical_harm_indicated": False,
                "human_review_required": True
            },
            "escalation_decision": {
                "reporting_pathway": "normal",
                "reason": "Language selected; awaiting incident details"
            },
            "report_quality": {
                "missing_fields": ["details"],
                "ai_confidence": "initial_connection"
            },
            "evidence_layer": {
                "name_evidence": "unknown",
                "frequency_evidence": "unknown",
                "location_evidence": "unknown"
            }
        }

    full_text = " ".join(incident_user_turns)
    lower = full_text.lower()

    # 1. Child Name & Anonymity
    name_match = re.search(r'\b(?:my name is|i am|i\'m|call me|name is)\s+([a-zA-Z]+)\b', lower)
    child_name = name_match.group(1).capitalize() if name_match else None

    is_anon = bool(re.search(r'\b(anonymous|stay anonymous|don\'t tell|dont tell|secret|private|no name)\b', lower))
    anon_pref = "anonymous" if is_anon else ("named" if child_name else "undecided")

    # 2. Location Extraction (Specific Gates & Campus Zones)
    loc = None
    # Check for specific Gate mentions (e.g. "second gate", "third gate", "gate 2", "behind second gate")
    gate_matches = re.findall(r'\b((?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|main|back|front|side)\s+gate|gate\s+[0-9]+)\b', lower)
    if gate_matches:
        clean_gates = list(dict.fromkeys([g.strip().title() for g in gate_matches]))
        loc = " / ".join(clean_gates)
    
    if not loc:
        ml_places = {
            "ക്ലാസ്": "Classroom",
            "ക്ലാസ്സ്": "Classroom",
            "ഗ്രൗണ്ട്": "School Ground",
            "ബസ്": "School Bus",
            "ബസ്സ്": "School Bus",
            "ഗേറ്റ്": "School Gate",
            "ബാത്റൂം": "Washroom",
            "ടോയ്‌ലറ്റ്": "Washroom",
            "ലൈബ്രറി": "Library",
            "കാന്റീൻ": "Canteen"
        }
        for ml_term, eng_loc in ml_places.items():
            if ml_term in lower:
                loc = eng_loc
                break

    if not loc:
        common_places = [
            "behind the lockers", "locker room", "lockers", "gymnasium", "gym",
            "playground", "cafeteria", "canteen", "bus stop", "school bus", "bus",
            "hallway", "corridor", "classroom", "bathroom", "restroom", "washroom",
            "library", "stairs", "staircase", "sports field", "football ground", "field",
            "school gate", "gate", "science lab", "lab", "auditorium", "parking lot"
        ]
        for place in common_places:
            if place in lower:
                loc = place.title()
                break
    if not loc:
        m = re.search(r'\b(?:at|in|near|behind|around|by|inside|outside)\s+(?:the\s+)?([a-zA-Z0-9\s]{2,25}?)(?=[,\.\?!]|\b(?:today|yesterday|during|at|when|and|he|she|they|i|my|every)\b|$)', lower)
        if m:
            candidate = m.group(1).strip()
            forbidden_candidates = {
                "school", "here", "it", "my", "me", "us", "malayalam", "english", "hindi", "tamil",
                "language", "secret", "private", "talk", "speaking", "speak", "trouble", "touch"
            }
            if candidate and len(candidate) > 2 and candidate.lower() not in forbidden_candidates:
                loc = candidate.title()

    # 3. Timeframe Extraction (Upcoming Event Days & Schedules)
    time_ctx = None
    time_match = re.search(r'\b((?:coming|this|next|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|tonight|today|yesterday|this morning|this afternoon|yesterday afternoon|yesterday morning|last week|after school|before school|during recess|during lunch|at break)\b', lower)
    if time_match:
        raw_t = time_match.group(1).title()
        if raw_t.lower() in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
            time_ctx = f"Coming {raw_t}"
        else:
            time_ctx = raw_t
    else:
        time_terms = [
            "during recess", "recess", "during lunch", "lunch break", "lunch time",
            "this morning", "this afternoon", "yesterday afternoon", "yesterday morning",
            "yesterday", "today", "last week", "after school", "before school",
            "during class", "at break", "break time", "every day", "everyday"
        ]
        for t in time_terms:
            if t in lower:
                time_ctx = t.title()
                break

    # 4. Implicated Persons & Suspects (Count, Alias, Roles)
    imp = None
    suspect_details = []
    # Count of dealers / suspects
    cnt_m = re.search(r'\b(?:total of|group of)\s+([0-9]+|[a-z]+)\b|\b([0-9]+)\s+(?:dealers|bullies|guys|people|men|individuals)\b', lower)
    if cnt_m:
        count_val = cnt_m.group(1) or cnt_m.group(2)
        suspect_details.append(f"{count_val} individuals/dealers")

    # Suspect name or alias
    name_m = re.search(r'\b(?:guys?\s+names?|name is|called|named|alias)\s+([a-zA-Z]+)\b', full_text, re.IGNORECASE)
    if name_m and name_m.group(1).lower() not in ("he", "she", "my", "our", "school", "the", "a", "it", "they"):
        suspect_details.append(f"alias/name '{name_m.group(1).capitalize()}'")

    tm = re.search(r'\b((?:mr\.|mrs\.|ms\.|miss|sir|coach|principal|teacher|dr\.)\s+[a-zA-Z]+)\b', full_text, re.IGNORECASE)
    if tm:
        imp = tm.group(1).title()
    elif suspect_details:
        imp = ", ".join(suspect_details)
    else:
        bm = re.search(r'\b([a-zA-Z]+)\s+(?:and\s+[a-zA-Z]+\s+)?(?:pushed|punched|hit|kicked|teased|mocked|shoved|stole|bullied|threatened|hurt|cursed|yelled)\b', full_text)
        if bm and bm.group(1).lower() not in ("he", "she", "they", "someone", "somebody", "a", "the", "my"):
            imp = bm.group(1).capitalize()
        else:
            by_m = re.search(r'\b(?:by|with)\s+([A-Z][a-z]+)\b', full_text)
            if by_m and by_m.group(1).lower() not in ("him", "her", "them", "me", "us", "my"):
                imp = by_m.group(1)

    # 5. Targeted Population / Victims
    target_pop = None
    if re.search(r'\b(other kids|other students|younger kids|children|classmates|everyone|my class|kids)\b', lower):
        target_pop = "Other students / school children"
    elif "me" in lower or "myself" in lower:
        target_pop = "Directly targeting reporting student"

    # 6. Specific Substance / Contraband / Weapon
    substance = None
    if re.search(r'\b(drug|drugs|weed|marijuana|pills|cocaine|narcotics|dealer|dealers|dealing)\b', lower):
        substance = "Illicit Drugs / Narcotics"
    elif re.search(r'\b(vape|vaping|e-cig)\b', lower):
        substance = "Vape / Nicotine"
    elif re.search(r'\b(alcohol|beer|liquor)\b', lower):
        substance = "Alcohol"
    elif re.search(r'\b(knife|gun|weapon|blade)\b', lower):
        substance = "Dangerous Weapon"

    # 7. Witnesses Extraction
    wit = None
    wm = re.search(r'\b(?:(?:my friend|classmate|witness|friend)\s+([A-Z][a-z]+)|([A-Z][a-z]+)\s+(?:saw it|saw this|was there|was with me))\b', full_text)
    if wm:
        wit = (wm.group(1) or wm.group(2)).capitalize()
    elif "my friend" in lower:
        wit = "Friend / Peer"
    elif "everyone" in lower or "all the kids" in lower:
        wit = "Classmates present"

    # 8. Physical Harm & Danger Indicators
    harm = bool(re.search(r'\b(hit|punch|punched|kick|kicked|shove|shoved|pushed|push|fight|fought|hurt|bleed|bleeding|bruise|bruised|slap|slapped|beat|തല്ലി|അടിച്ചു|തള്ളി|ഉപദ്രവിച്ചു|മുറിവേറ്റു|വേദനിപ്പിച്ചു|കരഞ്ഞു)\b', lower))
    danger = bool(re.search(r'\b(kill|knife|weapon|gun|emergency|die|suicide|hospital|right now|bleeding badly|drug dealing|dealers|കൊല്ലും|കത്തി|ആശുപത്രി)\b', lower))
    is_recurring = bool(re.search(r'\b(repeat|repeating|keeps|always|every day|everyday|again|often|constantly|എപ്പോഴും|വീണ്ടും|സ്ഥിരമായി)\b', lower))
    freq = "repeated" if is_recurring else ("one_time" if "today" in lower or "once" in lower else "unknown")

    # 9. Category & Escalation Determination
    is_drug_substance = bool(substance is not None or re.search(r'\b(drug|drugs|dealing|dealer|dealers|weed|substance|pills|മരുന്ന്|ഗുളിക|ലഹരി|കഞ്ചാവ്)\b', lower))

    is_teacher_mentioned = bool(
        (imp and re.search(r'\b(mr\.|mrs\.|ms\.|miss|sir|coach|principal|teacher|dr\.|ടീച്ചർ|മാഷ്|സാർ)\b', imp.lower())) or
        re.search(r'\b(teacher|sir|madam|miss|coach|principal|staff|ടീച്ചർ|മാഷ്|സാർ|ടീച്ചറെ|പ്രിൻസിപ്പൽ|മാഡം)\b', lower)
    )

    if is_teacher_mentioned:
        category = "teacher_involved"
        sev = "L3"
        esc_path = "higher_authority"
        esc_reason = "Teacher or school staff member implicated"
    elif is_drug_substance:
        category = "substance_abuse"
        sev = "L3"
        esc_path = "higher_authority"
        esc_reason = "Critical: Illicit substance dealing / drug distribution targeting students on school perimeter"
        danger = True
    elif danger:
        category = "physical_threat"
        sev = "L3"
        esc_path = "higher_authority"
        esc_reason = "Critical immediate safety emergency"
    elif harm:
        category = "physical_threat"
        sev = "L2"
        esc_path = "normal"
        esc_reason = "Physical altercation or harm reported"
    elif re.search(r'\b(bully|bullied|bullying|mock|tease|teasing|laugh|stole|money|name calling|കളിയാക്കി|റാഗിംഗ്|ഭീഷണിപ്പെടുത്തി|ഭീഷണി)\b', lower):
        category = "bullying"
        sev = "L2" if is_recurring else "L1"
        esc_path = "normal"
        esc_reason = "Peer bullying or interpersonal harassment"
    elif re.search(r'\b(exam|test|marks|grade|grades|study|homework|stress|failing|പരീക്ഷ|മാർക്ക്|പഠനം)\b', lower):
        category = "academic"
        sev = "L1"
        esc_path = "normal"
        esc_reason = "Academic distress or pressure"
    else:
        category = "safety"
        sev = "L1"
        esc_path = "normal"
        esc_reason = "General campus safety inquiry"

    # 10. Recommended Safeguarding Actions
    recommendations = []
    if is_drug_substance:
        recommendations.append(f"Deploy staff/police security detail to {loc or 'perimeter gates'} ({time_ctx or 'immediately'})")
        recommendations.append("Immediate escalation to school security and local police liaison")
        recommendations.append("Review perimeter CCTV camera footage")
    elif category == "teacher_involved":
        recommendations.append("Immediate confidential review by Designated Safeguarding Lead (DSL)")
        recommendations.append("Protect reporting child from retaliation")
    elif danger:
        recommendations.append("Immediate in-person welfare check and campus security dispatch")

    # 11. Concise Executive Summary
    summary_parts = []
    if child_name:
        summary_parts.append(f"Student {child_name}")
    else:
        summary_parts.append("Student")
    summary_parts.append(f"reported {category.replace('_', ' ')}")
    if imp:
        summary_parts.append(f"involving {imp}")
    if loc:
        summary_parts.append(f"at {loc}")
    if time_ctx:
        summary_parts.append(f"({time_ctx})")
    if target_pop:
        summary_parts.append(f"targeting {target_pop}")
    if wit:
        summary_parts.append(f"witnessed by {wit}")
    summary = " ".join(summary_parts) + "."

    return {
        "category": category,
        "severity_level": sev,
        "location": loc,
        "incident_timeframe": time_ctx,
        "implicated_person": imp,
        "witnesses_present": wit,
        "target_population": target_pop,
        "substance_involved": substance,
        "safeguarding_recommendations": recommendations,
        "physical_harm_indicated": harm,
        "immediate_danger": danger,
        "is_ongoing": is_recurring,
        "summary": summary,
        "is_escalation_required": (sev == "L3" or esc_path == "higher_authority"),
        "detected_emotion": "Empathetic",
        "identity": {
            "name": child_name,
            "name_provided": bool(child_name),
            "anonymous_preference": anon_pref,
            "identity_confirmation": "confirmed" if child_name else "not_confirmed"
        },
        "incident": {
            "category": category,
            "description": summary,
            "frequency": freq,
            "location": loc,
            "time_context": time_ctx,
            "implicated_person": imp,
            "witnesses_present": wit
        },
        "child_preferences": {
            "wants_anonymity": True if is_anon else None,
            "wants_to_continue": True,
            "preferred_support_person": None
        },
        "support_needs": {
            "requested_help": None,
            "concerns": ["worried_about_identity"] if "know" in lower or "tell" in lower else []
        },
        "safety_flags": {
            "urgent_review": (sev == "L3"),
            "immediate_danger": danger,
            "physical_harm_indicated": harm,
            "human_review_required": True
        },
        "escalation_decision": {
            "reporting_pathway": esc_path,
            "reason": esc_reason
        },
        "report_quality": {
            "missing_fields": [f for f, v in [("name", child_name), ("location", loc), ("time", time_ctx)] if not v],
            "ai_confidence": "high_fidelity_extraction"
        },
        "evidence_layer": {
            "name_evidence": "direct" if child_name else "unknown",
            "frequency_evidence": "direct" if is_recurring else "unknown",
            "location_evidence": "direct" if loc else "unknown"
        }
    }

def stream_qwen_chat(conversation_history, active_model, session_language="en"):
    """
    Streams response tokens and yields completed sentences.
    """
    # For Malayalam, always use the dedicated native Malayalam dialogue engine
    # (3B English-centric LLMs cannot generate grammatically correct Malayalam)
    if active_model == "safespeak-empathy-engine" or session_language == "ml":
        for s in generate_safespeak_empathy_sentences(conversation_history, session_language):
            yield s
        return

    system_prompt = CONVERSATIONAL_SYSTEM_PROMPT
    if session_language == "ml":
        system_prompt += "\n\nCRITICAL LANGUAGE INSTRUCTION:\nThe student has chosen to speak in Malayalam. You MUST formulate your entire response in natural, warm, simple spoken Malayalam (മലയാളത്തിൽ സംസാരിക്കുക). Keep it gentle, 1-2 short sentences (15-25 words). Do NOT use complex Sanskritized Malayalam or English."

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(conversation_history)

    payload = json.dumps({
        "model": active_model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": 0.35,
            "top_p": 0.9,
            "num_predict": 128
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            sentence_buffer = ""
            for line in res:
                if not line:
                    continue
                chunk = json.loads(line.decode("utf-8"))
                token = chunk.get("message", {}).get("content", "")
                sentence_buffer += token

                # Check if we completed a sentence
                match = re.search(r'([.!?]+(\s+|$))', sentence_buffer)
                if match:
                    end_idx = match.end()
                    sentence = sentence_buffer[:end_idx].strip()
                    sentence_buffer = sentence_buffer[end_idx:]
                    if sentence:
                        yield sentence

            # Yield any trailing text
            if sentence_buffer.strip():
                yield sentence_buffer.strip()

    except Exception as e:
        print(f"⚠️ Streaming inference error: {e}. Using dialogue fallback.")
        for s in generate_safespeak_empathy_sentences(conversation_history):
            yield s

def extract_slots_background(conversation_history, active_model):
    """Extracts structured safeguarding slots fast and accurately."""
    fast_report = generate_structured_report_offline(conversation_history)
    # If call is still in progress / language selection, do not query Ollama to prevent hallucinations
    if fast_report.get("summary", "").startswith("Call in progress") or active_model == "safespeak-empathy-engine":
        return fast_report

    try:
        flat_transcript = "\n".join([f"{msg['role']}: {msg['content']}" for msg in conversation_history])
        payload = json.dumps({
            "model": active_model,
            "messages": [
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": flat_transcript}
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1, "num_predict": 120}
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3.0) as res:
            result = json.loads(res.read().decode())
            content = result.get("message", {}).get("content", "{}")
            ollama_slots = json.loads(content)
            if isinstance(ollama_slots, dict):
                inc = ollama_slots.get("incident") or {}
                if inc.get("location"):
                    cand_loc = str(inc["location"]).strip()
                    if cand_loc.lower() not in ("malayalam", "english", "hindi", "tamil", "language"):
                        fast_report["location"] = cand_loc
                if inc.get("time_context"): fast_report["incident_timeframe"] = inc["time_context"]
                if inc.get("category"): fast_report["category"] = inc["category"]
                if ollama_slots.get("implicated_person"): fast_report["implicated_person"] = ollama_slots["implicated_person"]
                if ollama_slots.get("summary") and "malayalam" not in ollama_slots["summary"].lower():
                    fast_report["summary"] = ollama_slots["summary"]
                if ollama_slots.get("severity_level"): fast_report["severity_level"] = ollama_slots["severity_level"]
                if ollama_slots.get("escalation_decision"): fast_report["escalation_decision"] = ollama_slots["escalation_decision"]
                fast_report["incident"].update(inc)
                if ollama_slots.get("severity_level"): fast_report["severity_level"] = ollama_slots["severity_level"]
                if ollama_slots.get("escalation_decision"): fast_report["escalation_decision"] = ollama_slots["escalation_decision"]
                fast_report["incident"].update(inc)
    except Exception:
        pass

    return fast_report

async def handle_websocket_client(websocket, active_model):
    """Manages active Phone Booth call with streaming voice turns."""
    client_ip = websocket.remote_address[0] if hasattr(websocket, 'remote_address') else 'unknown'
    print(f"\n📞 [CALL CONNECTED] Phone Booth station connected from: {client_ip}")

    session_language = "en"
    conversation_history = []
    session_slots = {
        "category": "other",
        "severity_level": "L1",
        "location": None,
        "incident_timeframe": None,
        "implicated_person": None,
        "witnesses_present": None,
        "physical_harm_indicated": False,
        "is_ongoing": None,
        "immediate_danger": False,
        "is_escalation_required": False,
        "summary": ""
    }

    current_turn_task = None

    try:
        # Initial greeting: Phase 1 Welcoming the Child with bilingual language preference question
        initial_greeting = "Hello! Would you prefer to talk in English or Malayalam? ഏത് ഭാഷയിലാണ് സംസാരിക്കാൻ ഇഷ്ടം?"
        greeting_audio = await asyncio.get_running_loop().run_in_executor(None, synthesize_elevenlabs_b64, initial_greeting, "ml")
        
        await websocket.send(json.dumps({
            "type": "agent_stream_sentence",
            "sentence": initial_greeting,
            "audio_base64": greeting_audio,
            "detected_emotion": "Listening",
            "is_final_turn": True
        }))
        conversation_history.append({"role": "assistant", "content": initial_greeting})

        async def process_turn(student_text):
            nonlocal session_language
            try:
                print(f"🧒 Student: \"{student_text}\"")
                conversation_history.append({"role": "user", "content": student_text})

                # Check if student explicitly requests or starts speaking in Malayalam or English
                is_ml_choice = bool(re.search(r'\b(malayalam|മലയാളം|മലയാളത്തിൽ|സംസാരിക്കാം)\b|[\u0d00-\u0d7f]', student_text, re.IGNORECASE))
                is_en_choice = bool(re.search(r'\b(english|english please)\b', student_text, re.IGNORECASE))

                if is_ml_choice and session_language != "ml":
                    session_language = "ml"
                    print("🌐 [LANGUAGE SWITCHED] Session switched to Malayalam (ml-IN)")
                    await websocket.send(json.dumps({
                        "type": "language_switched",
                        "language": "ml"
                    }))
                elif is_en_choice and session_language != "en":
                    session_language = "en"
                    print("🌐 [LANGUAGE SWITCHED] Session switched to English (en-US)")
                    await websocket.send(json.dumps({
                        "type": "language_switched",
                        "language": "en"
                    }))

                # Signal client that AI is processing turn
                await websocket.send(json.dumps({"type": "agent_thinking"}))

                full_reply_text = ""
                loop = asyncio.get_running_loop()
                queue = asyncio.Queue()

                def producer():
                    try:
                        for s in stream_qwen_chat(conversation_history, active_model, session_language):
                            loop.call_soon_threadsafe(queue.put_nowait, s)
                    except Exception as pe:
                        print(f"⚠️ Streaming producer error: {pe}")
                    finally:
                        loop.call_soon_threadsafe(queue.put_nowait, None)

                stream_thread = threading.Thread(target=producer, daemon=True)
                stream_thread.start()

                while True:
                    sentence = await queue.get()
                    if sentence is None:
                        break
                    full_reply_text += " " + sentence
                    sentence_audio = await loop.run_in_executor(None, synthesize_elevenlabs_b64, sentence, session_language)
                    await websocket.send(json.dumps({
                        "type": "agent_stream_sentence",
                        "sentence": sentence,
                        "audio_base64": sentence_audio,
                        "detected_emotion": "Empathetic",
                        "is_final_turn": False
                    }))

                conversation_history.append({"role": "assistant", "content": full_reply_text.strip()})
                print(f"🤖 AI Spoke ({session_language}): \"{full_reply_text.strip()}\"")

                # Check for voice-activated goodbye / natural call conclusion (English and Malayalam)
                is_departure = bool(re.search(r'\b(goodbye|good bye|bye|bye bye|that\'s all|thats all|i\'m done|im done|thank you bye|hang up|end call|that is all|nothing else|see you|got to go|have to go|thank you that is all|i have to leave|done now|finish|വിട|ബൈ|മതി|തീർന്നു|ഇത്രയേ ഉള്ളൂ|പോവുകയാണ്)\b', student_text, re.IGNORECASE))
                ai_departure = bool(re.search(r'\b(goodbye|take care.*goodbye|farewell|bye now|safe day.*goodbye|സൂക്ഷ്മതയോടെ പോകുക.*ഗുഡ്ബൈ)\b', full_reply_text, re.IGNORECASE))
                if is_departure or ai_departure:
                    print("👋 [VOICE HANG UP] Natural goodbye detected. Emitting auto-hangup packet.")
                    await websocket.send(json.dumps({
                        "type": "agent_goodbye_conclusion",
                        "should_auto_hangup": True
                    }))

                # Asynchronously extract slots without blocking voice flow
                extracted = await loop.run_in_executor(
                    None, extract_slots_background, conversation_history, active_model
                )
                for k, v in extracted.items():
                    if v is not None and v != "":
                        session_slots[k] = v

                # Flatten nested fields so both nested schemas and flat properties are available
                inc = session_slots.get("incident") or {}
                safety = session_slots.get("safety_flags") or {}
                esc = session_slots.get("escalation_decision") or {}

                if inc.get("location"): session_slots["location"] = inc["location"]
                if inc.get("time_context"): session_slots["incident_timeframe"] = inc["time_context"]
                if inc.get("category"): session_slots["category"] = inc["category"]
                if session_slots.get("implicated_person"): session_slots["implicatedName"] = session_slots["implicated_person"]
                if extracted.get("substance_involved"): session_slots["substance_involved"] = extracted["substance_involved"]
                if extracted.get("target_population"): session_slots["target_population"] = extracted["target_population"]
                if extracted.get("safeguarding_recommendations"): session_slots["safeguarding_recommendations"] = extracted["safeguarding_recommendations"]
                if safety.get("physical_harm_indicated") is not None: session_slots["physical_harm_indicated"] = safety["physical_harm_indicated"]
                if safety.get("immediate_danger") is not None: session_slots["immediate_danger"] = safety["immediate_danger"]

                # Auto-escalation flag check (L3, teacher misconduct, illegal substance/drug dealing, or immediate danger)
                if (session_slots.get("category") == "teacher_involved" or
                    session_slots.get("category") == "substance_abuse" or
                    session_slots.get("severity_level") == "L3" or
                    session_slots.get("immediate_danger") is True or
                    (esc.get("reporting_pathway") == "higher_authority")):
                    session_slots["is_escalation_required"] = True

                await websocket.send(json.dumps({
                    "type": "turn_slots_updated",
                    "slots": session_slots,
                    "detected_emotion": session_slots.get("detected_emotion", "Listening"),
                    "severity_level": session_slots.get("severity_level", "L1"),
                    "category": session_slots.get("category", "other")
                }))

            except asyncio.CancelledError:
                print("🛑 [BARGE-IN CANCELLED] AI turn cancelled cleanly by student interruption.")
            except Exception as te:
                print(f"⚠️ Error in turn processing: {te}")

        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "student_speech")

                # Handle Client Language Switching Command
                if msg_type == "set_language":
                    lang = data.get("language", "en")
                    session_language = "ml" if lang == "ml" else "en"
                    print(f"🌐 [CLIENT SET LANGUAGE] Language explicitly set to: {session_language}")
                    await websocket.send(json.dumps({
                        "type": "language_switched",
                        "language": session_language
                    }))
                    continue

                # Handle Barge-In Interruption
                if msg_type == "barge_in":
                    print("🛑 [BARGE-IN] Student interrupted AI speech.")
                    if current_turn_task and not current_turn_task.done():
                        current_turn_task.cancel()
                    continue

                if msg_type == "call_ended":
                    print("📴 [CALL ENDED] Student hung up receiver.")
                    final_extraction = await asyncio.get_running_loop().run_in_executor(
                        None, extract_slots_background, conversation_history, active_model
                    )
                    await websocket.send(json.dumps({
                        "type": "call_summary",
                        "status": "completed",
                        "final_slots": final_extraction,
                        "turn_count": len(conversation_history)
                    }))
                    break

                if msg_type in ("student_speech", "student_audio"):
                    if current_turn_task and not current_turn_task.done():
                        current_turn_task.cancel()

                    if msg_type == "student_audio":
                        raw_b64 = data.get("audio_base64", "")
                        audio_bytes = base64.b64decode(raw_b64) if raw_b64 else b""
                        student_text = await asyncio.get_running_loop().run_in_executor(
                            None, transcribe_audio_bytes, audio_bytes, session_language
                        )
                        if not student_text:
                            continue
                        await websocket.send(json.dumps({
                            "type": "student_speech_transcribed",
                            "text": student_text
                        }))
                    else:
                        student_text = data.get("text", "").strip()

                    if student_text:
                        current_turn_task = asyncio.create_task(process_turn(student_text))

            except json.JSONDecodeError:
                print("⚠️ Invalid JSON packet received from client.")
            except Exception as inner_e:
                print(f"⚠️ Error handling message turn: {inner_e}")

    except Exception as e:
        print(f"📴 [CALL DISCONNECTED] Client connection dropped: {e}")

async def main_server():
    print("======================================================================")
    print("🛡️  SafeSpeak Phone Booth - Phase 3 AI Voice Engine (RTX 3050 6GB)")
    print("======================================================================")

    # 1. GPU Check
    check_nvidia_gpu()

    # 2. Ollama Setup
    success, models = start_ollama_service()
    if success and models:
        active_model = select_best_model(models) or "safespeak-empathy-engine"
    else:
        print("ℹ️  Ollama server not active. Enabling Resilient Zero-Dependency Safeguarding AI.")
        active_model = "safespeak-empathy-engine"

    # 4. Import websockets
    try:
        import websockets
    except ImportError:
        print("\n📦 Installing 'websockets' library for Python...")
        subprocess.run([sys.executable, "-m", "pip", "install", "websockets"])
        import websockets

    # 5. Launch WebSocket Server
    lan_ip = get_lan_ip()
    host_name = socket.gethostname().lower()
    print("\n======================================================================")
    print(f"🚀 SafeSpeak Streaming Voice Engine LIVE!")
    print(f"   - Local Loopback: ws://127.0.0.1:{WS_PORT}")
    print(f"   - LAN Address:    ws://{lan_ip}:{WS_PORT}")
    print(f"   - Hostname URL:   ws://{host_name}.local:{WS_PORT}")
    print(f"   - Active Model:   {active_model}")
    print(f"   - Latency Target: <150ms (Sentence-Streaming Mode)")
    print("======================================================================")
    print(f"💡 On your SafeSpeak Kiosk / Raspberry Pi, connect to:")
    print(f"   ⭐ ws://{host_name}.local:{WS_PORT}  (Works on ANY Wi-Fi without changing!)")
    print(f"   👉 ws://{lan_ip}:{WS_PORT}")
    print("======================================================================\n")

    async with websockets.serve(lambda ws: handle_websocket_client(ws, active_model), "0.0.0.0", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main_server())
    except KeyboardInterrupt:
        print("\n🛑 SafeSpeak Phone Booth Server stopped by user.")
