#!/usr/bin/env python3
"""
========================================================================================
SafeSpeak Phone Booth - Unified AI Server for Secondary Laptop (RTX 3050 6GB)
========================================================================================
This single script sets up and runs the entire AI Phone Booth backend:
1. Detects NVIDIA GPU (RTX 3050), CUDA availability, and VRAM.
2. Starts & configures Ollama on 0.0.0.0:11434 with CORS enabled.
3. Automatically checks and pulls 'qwen2.5:7b' (optimized for 6GB VRAM).
4. Launches a bi-directional WebSocket server on 0.0.0.0:8765.
5. Manages adaptive, in-depth empathetic dialogue turns with trauma-informed guidance.
6. Progressively extracts structured incident reports in real time.
========================================================================================
"""

import os
import sys
import json
import time
import socket
import shutil
import asyncio
import subprocess
import urllib.request
import urllib.error

# Server Configuration
OLLAMA_HOST = os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
TARGET_MODEL = os.environ.get("SAFESPEAK_MODEL", "qwen2.5:7b")
FALLBACK_MODEL = "qwen2.5:1.5b"
WS_PORT = int(os.environ.get("SAFESPEAK_WS_PORT", 8765))

# System Prompts & Inquiry Framework
PHONE_BOOTH_SYSTEM_PROMPT = """You are SafeSpeak AI, an automated assistant in a school safety phone booth.
A student facing an issue or distress has picked up the phone.
Your job is to:
1. Clearly identify yourself as an AI assistant helping connect the student with caring school staff.
2. Speak in a gentle, calm, reassuring tone suitable for young people.
3. Keep spoken replies CONCISE (1 to 2 sentences maximum) so the student is never overwhelmed.
4. Validate their feelings honestly ("I hear you", "You did the right thing by speaking up", "Thank you for sharing that with me").
5. NEVER make false promises: DO NOT say "you are completely safe", "nobody will ever know", or "this is 100% secret".
6. Ask EXACTLY ONE gentle question at a time to help understand their concern.
7. NEVER force disclosure: If the student doesn't want to give names, locations, or details, respect that immediately.
8. Adapt questions based on what they share:
   - Bullying: Ask about frequency, where it happens, or if friends saw it.
   - Teacher/Staff Misconduct: Acknowledge their bravery, ask about class or what happened.
   - Physical Danger: Check if they are physically hurt right now and need first aid.
   - Self-Harm/Crisis: Prioritize warmth, grounding, and immediate connection to human care.
   - Academic Distress: Normalize pressure, ask which class or expectations are causing stress.

Respond in JSON format with two keys:
{
  "speech": "Your 1-2 sentence spoken response to the student.",
  "detected_emotion": "Primary emotion (e.g. Scared, Anxious, Hurt, Lonely, Overwhelmed, Relieved, Heard)",
  "category_guess": "bullying" | "teacher_involved" | "physical_threat" | "self_harm" | "academic" | "other",
  "inquiry_state": "acknowledging" | "probing_location" | "probing_parties" | "probing_frequency" | "comforting_closing",
  "extracted_slots": {
    "category": string or null,
    "location": string or null,
    "implicated_person": string or null,
    "witnesses": string or null,
    "is_ongoing": boolean or null,
    "immediate_danger": boolean or null,
    "summary": "1 sentence progressive summary of the incident so far"
  }
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
        print("⚠️  nvidia-smi not found in PATH. GPU acceleration will depend on Ollama's auto-detection.")
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

    cmd = "ollama serve"
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

def ensure_model_available(models):
    """Pulls qwen2.5:7b if not present."""
    # Check if target model or close variant exists
    for m in models:
        if TARGET_MODEL in m or "qwen2.5" in m:
            print(f"✅ Found model ready for phone booth: {m}")
            return m

    print(f"\n📦 Target model '{TARGET_MODEL}' not found. Downloading via Ollama...")
    print(f"   (Qwen 2.5 7B Q4_K_M is ~4.7 GB and optimized for RTX 3050 6GB VRAM)")
    try:
        subprocess.run(["ollama", "pull", TARGET_MODEL], check=True)
        return TARGET_MODEL
    except Exception as e:
        print(f"⚠️ Failed to pull '{TARGET_MODEL}': {e}")
        print(f"Attempting fallback to '{FALLBACK_MODEL}'...")
        try:
            subprocess.run(["ollama", "pull", FALLBACK_MODEL], check=True)
            return FALLBACK_MODEL
        except Exception as e2:
            print(f"❌ Failed to pull fallback model: {e2}")
            return None

def query_qwen(conversation_history, active_model):
    """Queries Qwen 2.5 7B with conversation history and structured schema."""
    messages = [{"role": "system", "content": PHONE_BOOTH_SYSTEM_PROMPT}]
    messages.extend(conversation_history)

    payload = json.dumps({
        "model": active_model,
        "messages": messages,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.4,
            "top_p": 0.9,
            "num_predict": 256
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            result = json.loads(res.read().decode())
            content = result.get("message", {}).get("content", "{}")
            return json.loads(content)
    except Exception as e:
        print(f"⚠️ Error querying Qwen: {e}")
        # Safe fallback response
        return {
            "speech": "I am right here with you and listening carefully. Take your time, you are safe.",
            "detected_emotion": "Distressed",
            "category_guess": "other",
            "inquiry_state": "acknowledging",
            "extracted_slots": {
                "summary": "Student reported an issue via Phone Booth."
            }
        }

async def handle_websocket_client(websocket, active_model):
    """Handles an active phone booth session over WebSocket."""
    client_ip = websocket.remote_address[0] if hasattr(websocket, 'remote_address') else 'unknown'
    print(f"\n📞 [CALL CONNECTED] Phone Booth station connected from: {client_ip}")

    conversation_history = []
    session_slots = {
        "category": None,
        "location": None,
        "implicated_person": None,
        "witnesses": None,
        "is_ongoing": None,
        "immediate_danger": False,
        "summary": ""
    }

    try:
        # Send initial welcome greeting trigger with clear AI identity
        initial_greeting = {
            "type": "agent_response",
            "speech": "Hello, I am SafeSpeak AI, an automated helper here to listen and help share your concern with school counselors. Take your time—what would you like to talk about today?",
            "detected_emotion": "Listening",
            "category_guess": "other",
            "inquiry_state": "acknowledging",
            "slots": session_slots
        }
        await websocket.send(json.dumps(initial_greeting))
        conversation_history.append({"role": "assistant", "content": json.dumps(initial_greeting)})

        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "student_speech")

                if msg_type == "call_ended":
                    print(f"📴 [CALL ENDED] Student hung up receiver.")
                    final_summary = {
                        "type": "call_summary",
                        "status": "completed",
                        "final_slots": session_slots,
                        "turn_count": len(conversation_history)
                    }
                    await websocket.send(json.dumps(final_summary))
                    break

                if msg_type == "student_speech":
                    student_text = data.get("text", "").strip()
                    if not student_text:
                        continue

                    print(f"🧒 Student: \"{student_text}\"")
                    conversation_history.append({"role": "user", "content": student_text})

                    # Run inference in worker thread so async event loop is not blocked
                    loop = asyncio.get_running_loop()
                    ai_reply = await loop.run_in_executor(None, query_qwen, conversation_history, active_model)

                    # Update persistent slots
                    extracted = ai_reply.get("extracted_slots", {})
                    for k, v in extracted.items():
                        if v is not None and v != "":
                            session_slots[k] = v

                    print(f"🤖 AI: \"{ai_reply.get('speech')}\" [{ai_reply.get('detected_emotion')}]")

                    response_packet = {
                        "type": "agent_response",
                        "speech": ai_reply.get("speech"),
                        "detected_emotion": ai_reply.get("detected_emotion", "Neutral"),
                        "category_guess": ai_reply.get("category_guess", "other"),
                        "inquiry_state": ai_reply.get("inquiry_state", "acknowledging"),
                        "slots": session_slots
                    }

                    await websocket.send(json.dumps(response_packet))
                    conversation_history.append({"role": "assistant", "content": json.dumps(ai_reply)})

            except json.JSONDecodeError:
                print("⚠️ Invalid JSON packet received from client.")
            except Exception as inner_e:
                print(f"⚠️ Error handling message turn: {inner_e}")

    except Exception as e:
        print(f"📴 [CALL DISCONNECTED] Client connection dropped: {e}")

async def main_server():
    print("======================================================================")
    print("🛡️  SafeSpeak Phone Booth - Secondary Laptop AI Engine (RTX 3050 6GB)")
    print("======================================================================")

    # 1. GPU Check
    check_nvidia_gpu()

    # 2. Ollama Setup
    success, models = start_ollama_service()
    if not success:
        print("❌ Could not connect to or start Ollama server.")
        return

    # 3. Model Verification
    active_model = ensure_model_available(models)
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
    print("\n======================================================================")
    print(f"🚀 SafeSpeak WebSocket AI Gateway LIVE!")
    print(f"   - Local Loopback: ws://127.0.0.1:{WS_PORT}")
    print(f"   - LAN Address:    ws://{lan_ip}:{WS_PORT}")
    print(f"   - Active Model:   {active_model}")
    print("======================================================================")
    print(f"💡 On your SafeSpeak Kiosk / Raspberry Pi, enter:")
    print(f"   ws://{lan_ip}:{WS_PORT}")
    print("======================================================================\n")

    async with websockets.serve(lambda ws: handle_websocket_client(ws, active_model), "0.0.0.0", WS_PORT):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main_server())
    except KeyboardInterrupt:
        print("\n🛑 SafeSpeak Phone Booth Server stopped by user.")
