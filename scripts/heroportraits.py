import os
import re
from pathlib import Path
import requests

API_URL = "https://assets.deadlock-api.com/v2/heroes"
OUT_DIR = Path("deadlock_hero_images")
TIMEOUT = 30

OUT_DIR.mkdir(parents=True, exist_ok=True)

def safe(s: str) -> str:
    s = str(s or "").strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"\s+", "_", s)
    return s or "UNKNOWN"

def guess_ext(url: str) -> str:
    u = url.lower()
    for ext in (".webp", ".png", ".jpg", ".jpeg"):
        if u.endswith(ext):
            return ext
    return ""  # fallback (rare)

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0",
    "Accept": "image/webp,image/*,*/*;q=0.8",
    "Referer": "https://deadlock-api.com/"
})

# 1) Fetch hero JSON
r = session.get(API_URL, timeout=TIMEOUT)
r.raise_for_status()
heroes = r.json()

print(f"Found {len(heroes)} heroes.")

downloaded = 0
skipped = 0
failed = []

# 2) Download all image URLs for each hero
for hero in heroes:
    name = hero.get("name") or hero.get("class_name") or f"id_{hero.get('id','unknown')}"
    images = hero.get("images")

    if not isinstance(images, dict) or not images:
        failed.append((name, "missing images dict"))
        continue

    hero_dir = OUT_DIR / safe(name)
    hero_dir.mkdir(parents=True, exist_ok=True)

    for key, url in images.items():
        if not isinstance(url, str) or not url.startswith("http"):
            continue

        out_path = hero_dir / f"{safe(key)}{guess_ext(url)}"

        if out_path.exists() and out_path.stat().st_size > 0:
            skipped += 1
            continue

        try:
            img = session.get(url, timeout=TIMEOUT)
            img.raise_for_status()
            out_path.write_bytes(img.content)
            downloaded += 1
            print(f"✅ {name} | {key}")
        except Exception as e:
            failed.append((f"{name}:{key}", str(e)))
            print(f"❌ {name} | {key} -> {e}")

print("\n--- SUMMARY ---")
print("Downloaded:", downloaded)
print("Skipped:", skipped)
print("Failed:", len(failed))
if failed:
    print("First 20 failures:")
    for item, err in failed[:20]:
        print(" -", item, ":", err)