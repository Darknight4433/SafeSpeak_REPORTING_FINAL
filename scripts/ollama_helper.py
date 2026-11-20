#!/usr/bin/env python3
"""
SafeSpeak Ollama Helper Script
Checks Ollama status, starts the Ollama background service if needed,
and verifies model availability for complaint classification.
"""

import sys
import json
import urllib.request
import urllib.error
import shutil
import subprocess
import time

OLLAMA_HOST = "http://127.0.0.1:11434"
RECOMMENDED_MODEL = "llama3.2:1b"

def check_server_running():
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags", headers={"User-Agent": "SafeSpeak-Checker"})
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                data = json.loads(response.read().decode())
                return True, data.get("models", [])
    except Exception:
        pass
    return False, []

def check_cli_installed():
    return shutil.which("ollama") is not None

def test_classification(model_name):
    print(f"\n🧠 Testing classification with model '{model_name}'...")
    sample_text = "The math teacher slapped my classmate and threatened to fail him"
    
    prompt = f"""You are the AI Safety Classifier for SafeSpeak.
Analyze this student complaint:
"{sample_text}"

Respond in JSON format:
{{
  "category": "teacher_involved" | "physical_threat" | "bullying" | "self_harm" | "other",
  "risk_level": "L0" | "L1" | "L2" | "L3",
  "is_teacher_involved": boolean,
  "explanation": "brief 1 sentence reason"
}}"""

    payload = json.dumps({
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "format": "json"
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            result = json.loads(response.read().decode())
            parsed = json.loads(result.get("response", "{}"))
            print("✅ Ollama classification response:")
            print(json.dumps(parsed, indent=2))
            return True
    except Exception as e:
        print(f"❌ Test classification failed: {e}")
        return False

def main():
    print("========================================")
    print("   SafeSpeak Ollama Background Setup    ")
    print("========================================")

    cli_found = check_cli_installed()
    print(f"1. Ollama CLI installed: {'✅ Yes' if cli_found else '❌ No (download from https://ollama.com)'}")

    is_running, models = check_server_running()
    if is_running:
        print("2. Ollama server:        ✅ Running on http://127.0.0.1:11434")
    else:
        print("2. Ollama server:        ⚠️ Not currently running")
        if cli_found:
            print("   Attempting to start Ollama background server...")
            try:
                subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(3)
                is_running, models = check_server_running()
                if is_running:
                    print("   ✅ Ollama server started successfully!")
                else:
                    print("   ⚠️ Server didn't respond yet. Run 'ollama serve' in a separate terminal.")
            except Exception as e:
                print(f"   ⚠️ Could not start server automatically: {e}")
        else:
            print("   Please install Ollama from https://ollama.com/download/windows")

    model_names = [m.get("name", "") for m in models]
    print(f"3. Installed models:     {model_names if model_names else 'None'}")

    if is_running:
        target_model = None
        if model_names:
            target_model = model_names[0]
        else:
            print(f"\nNo models found. You can pull the recommended model by running:")
            print(f"   ollama pull {RECOMMENDED_MODEL}")
            if cli_found:
                ans = input(f"Would you like to pull '{RECOMMENDED_MODEL}' now? (y/N): ").strip().lower()
                if ans == 'y':
                    print(f"Pulling {RECOMMENDED_MODEL}...")
                    subprocess.run(["ollama", "pull", RECOMMENDED_MODEL])
                    target_model = RECOMMENDED_MODEL

        if target_model:
            test_classification(target_model)

    print("\nSafeSpeak Web Configuration:")
    print(" - Vite Proxy: /api/ollama -> http://127.0.0.1:11434")
    print(" - Default Model: VITE_OLLAMA_MODEL (defaults to llama3.2:1b)")
    print(" - Automatic Fallback: Local rule engine is always active if Ollama is offline.")

if __name__ == "__main__":
    main()
