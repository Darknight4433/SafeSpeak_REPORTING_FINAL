#!/usr/bin/env python3
"""
Downloads and extracts the lightweight Vosk English speech model.
Target location: ~/.local/share/vosk-model-small-en-us-0.15
"""
import os
import sys
import urllib.request
import zipfile

MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
TARGET_DIR = os.path.expanduser("~/.local/share")
MODEL_DIR = os.path.join(TARGET_DIR, "vosk-model-small-en-us-0.15")

def download_and_extract():
    if os.path.exists(MODEL_DIR):
        print(f"✅ Vosk model already exists at: {MODEL_DIR}")
        return

    os.makedirs(TARGET_DIR, exist_ok=True)
    zip_path = os.path.join(TARGET_DIR, "vosk-model.zip")

    print(f"📥 Downloading Vosk small model (~40MB) from {MODEL_URL}...")
    def reporthook(blocknum, blocksize, totalsize):
        read = blocknum * blocksize
        if totalsize > 0:
            percent = min(100.0, read * 100.0 / totalsize)
            sys.stdout.write(f"\rProgress: {percent:.1f}% ({read // (1024*1024)}MB / {totalsize // (1024*1024)}MB)")
            sys.stdout.flush()

    urllib.request.urlretrieve(MODEL_URL, zip_path, reporthook)
    print("\n📦 Extracting model...")

    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(TARGET_DIR)

    if os.path.exists(zip_path):
        os.remove(zip_path)

    print(f"🎉 Model installed successfully at: {MODEL_DIR}")

if __name__ == "__main__":
    download_and_extract()
