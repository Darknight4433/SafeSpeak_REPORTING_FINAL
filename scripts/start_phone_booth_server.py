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

def synthesize_elevenlabs_b64(text: str):
    """Synthesizes high-fidelity voice via ElevenLabs Turbo v2.5 with automatic key rotation."""
    global current_eleven_key_idx
    if not text or not text.strip():
        return None
    clean_text = re.sub(r'[*_#`~]', '', text).strip()

    for _ in range(len(ELEVEN_LABS_KEYS)):
        key = ELEVEN_LABS_KEYS[current_eleven_key_idx]
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVEN_LABS_VOICE_ID}/stream?optimize_streaming_latency=4"
        payload = json.dumps({
            "text": clean_text,
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.8
            }
        }).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": key
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=7) as res:
                return base64.b64encode(res.read()).decode("ascii")
        except urllib.error.HTTPError as he:
            print(f"⚠️ ElevenLabs key #{current_eleven_key_idx+1} status {he.code}. Rotating key...")
            current_eleven_key_idx = (current_eleven_key_idx + 1) % len(ELEVEN_LABS_KEYS)
        except Exception as e:
            print(f"⚠️ ElevenLabs key #{current_eleven_key_idx+1} error: {e}. Rotating key...")
            current_eleven_key_idx = (current_eleven_key_idx + 1) % len(ELEVEN_LABS_KEYS)
    return None

def transcribe_elevenlabs_bytes(audio_bytes: bytes) -> str | None:
    """Transcribes audio using ElevenLabs Scribe STT with automatic key rotation."""
    global current_eleven_key_idx
    if not audio_bytes or len(audio_bytes) < 400:
        return None

    boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    parts = [
        b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n',
        b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n' + audio_bytes + b'\r\n',
        b'--' + boundary.encode() + b'--\r\n'
    ]
    body = b''.join(parts)

    for _ in range(len(ELEVEN_LABS_KEYS)):
        key = ELEVEN_LABS_KEYS[current_eleven_key_idx]
        url = "https://api.elevenlabs.io/v1/speech-to-text"
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "xi-api-key": key,
                "Content-Type": "multipart/form-data; boundary=" + boundary
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                result = json.loads(res.read().decode("utf-8"))
                raw_text = result.get("text", "").strip()
                # Clean out audio event tags like [phone beeping], [laughter], [cough], [applause], [sigh]
                clean_text = re.sub(r'\[.*?\]', '', raw_text).strip()
                if clean_text:
                    print(f"🎙️ [ElevenLabs STT] Transcribed: \"{clean_text}\"")
                    return clean_text
                elif raw_text:
                    print(f"ℹ️ [ElevenLabs STT] Ambient audio tag ignored: \"{raw_text}\"")
                return ""
        except urllib.error.HTTPError as he:
            print(f"⚠️ ElevenLabs STT key #{current_eleven_key_idx+1} status {he.code}. Rotating key...")
            current_eleven_key_idx = (current_eleven_key_idx + 1) % len(ELEVEN_LABS_KEYS)
        except Exception as e:
            print(f"⚠️ ElevenLabs STT key #{current_eleven_key_idx+1} error: {e}. Rotating key...")
            current_eleven_key_idx = (current_eleven_key_idx + 1) % len(ELEVEN_LABS_KEYS)
    return None

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
   - "higher_authority": If the incident involves a teacher, school staff member, principal, or severe physical harm/danger.
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
    "category": "bullying" | "teacher_involved" | "abuse" | "academic" | "safety" | "other",
    "description": string,
    "frequency": "repeated" | "one_time" | "unknown",
    "location": string or null,
    "time_context": string or null
  },
  "implicated_person": string or null,
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

def generate_safespeak_empathy_sentences(conversation_history):
    """
    Intelligent child safeguarding dialog engine following the 3 Safeguarding Phases.
    Provides instant, zero-latency empathetic spoken responses without external LLM dependencies.
    """
    user_turns = [msg.get("content", "").strip() for msg in conversation_history if msg.get("role") == "user"]
    if not user_turns:
        return ["Hi. I'm here to listen. You can tell me anything that's been bothering you, at your own pace."]
    
    last_text = user_turns[-1].lower()
    full_text = " ".join(user_turns).lower()

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
    """Generates structured report JSON matching the official schema."""
    user_turns = [msg.get("content", "").strip() for msg in conversation_history if msg.get("role") == "user"]
    full_text = " ".join(user_turns)
    lower = full_text.lower()

    name_match = re.search(r'\b(?:my name is|i am|i\'m|call me|name is)\s+([a-zA-Z]+)\b', lower)
    child_name = name_match.group(1).capitalize() if name_match else None

    is_anon = bool(re.search(r'\b(anonymous|stay anonymous|don\'t tell|dont tell|secret|private|no name)\b', lower))
    anon_pref = "anonymous" if is_anon else ("named" if child_name else "undecided")

    is_recurring = bool(re.search(r'\b(repeat|repeating|keeps|always|every day|everyday|again|often)\b', lower))
    freq = "repeated" if is_recurring else ("one_time" if "today" in lower or "once" in lower else "unknown")

    category = "other"
    if re.search(r'\b(teacher|sir|madam|miss|coach|principal|staff)\b', lower):
        category = "teacher_involved"
    elif re.search(r'\b(bully|bullied|bullying|mock|tease|teasing|laugh)\b', lower):
        category = "peer_interpersonal_concern"
    elif re.search(r'\b(hit|kick|punch|fight|hurt|physical|bleed)\b', lower):
        category = "physical_threat"

    loc = None
    for place in ["lunch", "classroom", "hallway", "playground", "cafeteria", "bus", "bathroom", "school"]:
        if place in lower:
            loc = place
            break

    is_urgent = bool(re.search(r'\b(kill|suicide|weapon|knife|gun|die|bleed|hospital|emergency)\b', lower))
    sev = "L3" if is_urgent or category == "teacher_involved" else ("L2" if is_recurring else "L1")

    return {
        "identity": {
            "name": child_name,
            "name_provided": bool(child_name),
            "anonymous_preference": anon_pref,
            "identity_confirmation": "confirmed" if child_name else "not_confirmed"
        },
        "incident": {
            "category": category,
            "description": full_text[:200] if full_text else "Phone booth voice disclosure",
            "frequency": freq,
            "location": loc,
            "time_context": "after lunch" if "lunch" in lower else None
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
            "urgent_review": is_urgent,
            "human_review_required": True
        },
        "report_quality": {
            "missing_fields": [f for f, v in [("name", child_name), ("location", loc)] if not v],
            "ai_confidence": "direct_statements"
        },
        "evidence_layer": {
            "name_evidence": "direct" if child_name else "unknown",
            "frequency_evidence": "direct" if is_recurring else "unknown",
            "location_evidence": "direct" if loc else "unknown"
        },
        "detected_emotion": "Empathetic",
        "severity_level": sev,
        "summary": full_text[:160] if full_text else "Student shared concerns in phone booth"
    }

def stream_qwen_chat(conversation_history, active_model):
    """
    Streams response tokens and yields completed sentences.
    """
    if active_model == "safespeak-empathy-engine":
        for s in generate_safespeak_empathy_sentences(conversation_history):
            yield s
        return

    messages = [{"role": "system", "content": CONVERSATIONAL_SYSTEM_PROMPT}]
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
    """Extracts structured safeguarding slots from the conversation."""
    if active_model == "safespeak-empathy-engine":
        return generate_structured_report_offline(conversation_history)

    flat_transcript = "\n".join([f"{msg['role']}: {msg['content']}" for msg in conversation_history])
    
    payload = json.dumps({
        "model": active_model,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": flat_transcript}
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 250}
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            result = json.loads(res.read().decode())
            content = result.get("message", {}).get("content", "{}")
            return json.loads(content)
    except Exception as e:
        print(f"⚠️ Background extraction error: {e}")
        return generate_structured_report_offline(conversation_history)

async def handle_websocket_client(websocket, active_model):
    """Manages active Phone Booth call with streaming voice turns."""
    client_ip = websocket.remote_address[0] if hasattr(websocket, 'remote_address') else 'unknown'
    print(f"\n📞 [CALL CONNECTED] Phone Booth station connected from: {client_ip}")

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
        # Initial greeting: Phase 1 Welcoming the Child
        initial_greeting = "Hi. I'm here to listen. You can tell me anything that's been bothering you, at your own pace. You don't have to explain everything perfectly, and if you don't want to answer something, that's okay too."
        greeting_audio = await asyncio.get_running_loop().run_in_executor(None, synthesize_elevenlabs_b64, initial_greeting)
        
        await websocket.send(json.dumps({
            "type": "agent_stream_sentence",
            "sentence": initial_greeting,
            "audio_base64": greeting_audio,
            "detected_emotion": "Listening",
            "is_final_turn": True
        }))
        conversation_history.append({"role": "assistant", "content": initial_greeting})

        async def process_turn(student_text):
            try:
                print(f"🧒 Student: \"{student_text}\"")
                conversation_history.append({"role": "user", "content": student_text})

                # Signal client that AI is processing turn
                await websocket.send(json.dumps({"type": "agent_thinking"}))

                full_reply_text = ""
                loop = asyncio.get_running_loop()
                queue = asyncio.Queue()

                def producer():
                    try:
                        for s in stream_qwen_chat(conversation_history, active_model):
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
                    sentence_audio = await loop.run_in_executor(None, synthesize_elevenlabs_b64, sentence)
                    await websocket.send(json.dumps({
                        "type": "agent_stream_sentence",
                        "sentence": sentence,
                        "audio_base64": sentence_audio,
                        "detected_emotion": "Empathetic",
                        "is_final_turn": False
                    }))

                conversation_history.append({"role": "assistant", "content": full_reply_text.strip()})
                print(f"🤖 AI Spoke: \"{full_reply_text.strip()}\"")

                # Check for voice-activated goodbye / natural call conclusion
                is_departure = bool(re.search(r'\b(goodbye|good bye|bye|bye bye|that\'s all|thats all|i\'m done|im done|thank you bye|hang up|end call|that is all|nothing else|see you|got to go|have to go|thank you that is all|i have to leave|done now|finish)\b', student_text, re.IGNORECASE))
                ai_departure = bool(re.search(r'\b(goodbye|take care.*goodbye|farewell|bye now|safe day.*goodbye)\b', full_reply_text, re.IGNORECASE))
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

                # Auto-escalation flag check (L3, teacher misconduct, or immediate danger)
                if (session_slots.get("category") == "teacher_involved" or
                    session_slots.get("severity_level") == "L3" or
                    session_slots.get("immediate_danger") is True):
                    session_slots["is_escalation_required"] = True

                await websocket.send(json.dumps({
                    "type": "turn_slots_updated",
                    "slots": session_slots,
                    "detected_emotion": extracted.get("detected_emotion", "Listening"),
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
                        student_text = await asyncio.get_running_loop().run_in_executor(None, transcribe_elevenlabs_bytes, audio_bytes)
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
