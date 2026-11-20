# Ollama AI Integration for SafeSpeak

SafeSpeak features an Ollama LLM integration to automatically classify and evaluate student complaints in the background.

---

## 🚀 How It Works

1. **Background LLM Classification**:
   - When a student describes an issue, the text is processed by Ollama in the background.
   - Ollama returns structured JSON containing:
     - **Category**: `teacher_involved`, `physical_threat`, `sexual_abuse`, `self_harm`, `bullying`, `academic_pressure`, `emotional_distress`, `normal_discipline`, or `prank`.
     - **Risk Level**: `L0` (Harmless), `L1` (Low), `L2` (Moderate/Bullying), `L3` (Critical Emergency).
     - **Routing Target**: `higher_authority`, `principal`, `school_counselor`, `suicide_prevention`, or `counselor_review`.
     - **Explanation & Action**: Concise reasons and recommended steps for triage staff.

2. **Zero-CORS Vite Proxy**:
   - The Vite development server automatically proxies requests from `/api/ollama` to `http://127.0.0.1:11434`.
   - No complex CORS or header configuration is required.

3. **100% Offline / Non-blocking Fallback**:
   - If Ollama is not installed or the service is not currently running, SafeSpeak automatically falls back to its local client-side rule & pattern engine.
   - The user never experiences timeouts, crashes, or blocked submissions.

---

## 🛠️ Setup Instructions

### Step 1: Install Ollama (If Not Already Installed)
- Download and run the installer for Windows from: **[https://ollama.com/download/windows](https://ollama.com/download/windows)**
- Follow the standard setup wizard.

### Step 2: Download a Lightweight Model
Open PowerShell or Command Prompt and pull the recommended fast model:
```bash
ollama pull llama3.2:1b
```
*(Alternative models supported: `llama3.2`, `qwen2.5:1.5b`, `mistral`, `phi3`, `gemma2:2b`)*

### Step 3: Start the Ollama Background Server
You can start Ollama with any of the following:

- **Option A (via npm script)**:
  ```bash
  npm run ollama:start
  ```

- **Option B (via terminal command)**:
  ```bash
  ollama serve
  ```

- **Option C (via Python check helper)**:
  ```bash
  npm run ollama:check
  ```

---

## 🧪 Testing the Integration

### 1. Test from the SafeSpeak Web UI
1. Start your dev server:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:8080/report`.
3. In the description box, you will see the **AI Classifier** status bar:
   - 🟢 `Ollama (llama3.2:1b)` — Connected and ready
   - ⚪ `Ollama Offline (Using Rule AI)` — Fallback active
4. Type a test complaint:
   > *"The math teacher slapped my friend and threatened to fail him"*
5. Click **Analyze with AI** (or pause typing for 1.5 seconds for live analysis).
6. You will see:
   - **Level L3 (Critical)**
   - **Category: teacher_involved**
   - **Badge**: `Powered by Ollama (llama3.2:1b)`
   - AI explanation and recommended action!

### 2. Test from CLI
Run the automated diagnostic script:
```bash
python scripts/ollama_helper.py
```

---

## ⚙️ Configuration Variables

In your [.env](file:///c:/Users/USER/OneDrive/Music/SafeSpeak_REPORTING_FINAL-main/.env) file:
```env
# Optional: Ollama Endpoint (defaults to /api/ollama proxy)
VITE_OLLAMA_URL=/api/ollama

# Optional: Default Model (defaults to llama3.2:1b)
VITE_OLLAMA_MODEL=llama3.2:1b
```
