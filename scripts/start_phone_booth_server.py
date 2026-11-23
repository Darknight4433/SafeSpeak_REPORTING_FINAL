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
import subprocess
import urllib.request
import urllib.error

# Server Configuration
OLLAMA_HOST = os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("SAFESPEAK_MODEL", "llama3.2:3b")
TARGET_MODELS = [DEFAULT_MODEL, "llama3.2:3b", "qwen2.5:3b", "llama3.2:1b", "qwen2.5:1.5b"]
WS_PORT = int(os.environ.get("SAFESPEAK_WS_PORT", 8765))

# Safeguarding Conversational Persona Prompt (Emotionally Intelligent, Spoken Voice Mode)
CONVERSATIONAL_SYSTEM_PROMPT = """You are SafeSpeak AI, an emotionally intelligent, warm, gentle, and deeply caring companion in a school safety phone booth (similar to ChatGPT Voice mode).
A student is speaking to you over the telephone handset.

CRITICAL CONVERSATIONAL & SAFEGUARDING GUIDELINES:
1. Speak in a warm, conversational, soothing, human tone with genuine empathy.
2. Validate emotions deeply:
   - If they sound sad or hurt: "I am so sorry you are going through this. You don't have to carry this alone, and I am listening."
   - If they sound anxious or afraid: "Take a gentle breath. You did the right thing by speaking up, and you are not in trouble."
   - If they share an incident: "Thank you for trusting me with that. It takes real courage to tell someone."
3. Keep spoken replies CONCISE (1 to 2 warm, natural spoken sentences at a time, 15 to 35 words max) so the conversation flows like a real phone call with no long monologues.
4. Ask EXACTLY ONE gentle follow-up question at a time to help understand their concern.
5. NEVER make false promises: NEVER say "you are 100% safe" or "nobody will ever know". You are helping share this with caring school counselors.
6. Optional details: If the student doesn't want to give names or locations, respect that immediately.
7. SPOKEN VOICE OUTPUT RULES:
   - NEVER use asterisks, markdown formatting, emojis, bullet points, numbered lists, or stage directions.
   - Write ONLY clean, plain English sentences suitable for a spoken voice synthesizer.
8. NATURAL GOODBYES & CALL CONCLUSION:
   If the student says "goodbye", "bye", "that's all", "I'm done", "thank you bye", "hang up", "have to go", or indicates they want to finish:
   Respond with a warm, comforting closing statement ending in goodbye:
   "Thank you for sharing this with me. Your report has been safely noted for our counselors, and you did wonderfully by speaking up today. Take care, and goodbye!"
"""

EXTRACTION_SYSTEM_PROMPT = """You are the SafeSpeak Safeguarding Data Analyst.
Your role is to objectively extract incident safeguarding facts from the student-AI conversation transcript.

CRITICAL EXTRACTION RULES:
1. ONLY extract information explicitly stated by the student. NEVER assume, guess, or hallucinate names, locations, or actions.
2. If the student did not mention an item, return null for that field.
3. Keep the factual summary strictly objective, neutral, and professional for school child-protection officers.
4. Categorize risk severity:
   - "L3": Urgent danger (self-harm, sexual abuse, weapons, teacher/staff abuse).
   - "L2": Moderate concern (bullying, harassment, ongoing peer conflicts).
   - "L1": Mild concern (stress, academic pressure, mild emotional distress).
   - "L0": General inquiries, prank, or neutral disclosures.

Respond ONLY with valid JSON matching this schema:
{
  "detected_emotion": string,
  "category": "bullying" | "teacher_involved" | "physical_threat" | "self_harm" | "academic" | "other",
  "severity_level": "L0" | "L1" | "L2" | "L3",
  "location": string or null,
  "incident_timeframe": string or null,
  "implicated_person": string or null,
  "witnesses_present": string or null,
  "physical_harm_indicated": boolean,
  "is_ongoing": boolean or null,
  "immediate_danger": boolean,
  "is_escalation_required": boolean,
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
            
            for _ in range(12):
                time.sleep(1.5)
                running, models = is_ollama_running()
                if running:
                    print("✅ Ollama successfully started on 0.0.0.0:11434!")
                    return True, models
        except Exception as e:
            print(f"❌ Error launching Ollama: {e}")
    else:
        print("❌ 'ollama' command not found! Please install Ollama from https://ollama.com")
        sys.exit(1)

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

def stream_qwen_chat(conversation_history, active_model):
    """
    Streams response tokens from Qwen 2.5 and yields completed sentences.
    Sentence boundary regex: [.!?\\n] followed by space or end.
    """
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
        print(f"⚠️ Streaming inference error: {e}")
        yield "I hear you, and I am listening carefully. You did the right thing by speaking with me."

def extract_slots_background(conversation_history, active_model):
    """Extracts structured safeguarding slots from the conversation."""
    flat_transcript = "\n".join([f"{msg['role']}: {msg['content']}" for msg in conversation_history])
    
    payload = json.dumps({
        "model": active_model,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": flat_transcript}
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 200}
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
        return {
            "detected_emotion": "Listening",
            "category": "other",
            "inquiry_state": "acknowledging",
            "summary": "Student reported a concern via Voice Booth."
        }

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
        # Initial greeting with clear AI identity and ElevenLabs HD audio
        initial_greeting = "Hello, I am SafeSpeak AI, an automated helper here to listen and help share your concern with school counselors. Take your time—what would you like to talk about today?"
        greeting_audio = await asyncio.get_running_loop().run_in_executor(None, synthesize_elevenlabs_b64, initial_greeting)
        
        await websocket.send(json.dumps({
            "type": "agent_stream_sentence",
            "sentence": initial_greeting,
            "audio_base64": greeting_audio,
            "detected_emotion": "Listening",
            "is_final_turn": True
        }))
        conversation_history.append({"role": "assistant", "content": initial_greeting})

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

                if msg_type == "student_speech":
                    student_text = data.get("text", "").strip()
                    if not student_text:
                        continue

                    print(f"🧒 Student: \"{student_text}\"")
                    conversation_history.append({"role": "user", "content": student_text})

                    # Signal client that AI is processing turn
                    await websocket.send(json.dumps({"type": "agent_thinking"}))

                    # Stream sentences in real time as each sentence is formed (<150ms latency)
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
                    async def async_extract():
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

                    asyncio.create_task(async_extract())

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
    if not success:
        print("❌ Could not connect to or start Ollama server.")
        return

    # 3. Model Verification & Selection
    active_model = select_best_model(models)
    if not active_model:
        print("❌ No AI model available to run.")
        return

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
