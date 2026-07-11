import json
import requests
import base64
import os

# Configuration
GITHUB_TOKEN = "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"
REPO = "CricZone/Nowshin-tv"
JSON_FILE = "channels.json"
M3U_FILE = "playlist.m3u"

def get_github_file(path):
    url = f"https://api.github.com/repos/{REPO}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}"}
    r = requests.get(url, headers=headers)
    if r.status_code == 200:
        data = r.json()
        return json.loads(base64.b64decode(data['content'])), data['sha']
    return [], None

def update_github_file(path, content, sha, message):
    url = f"https://api.github.com/repos/{REPO}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}"}
    data = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "sha": sha
    }
    requests.put(url, headers=headers, json=data)

def check_link(url):
    try:
        # Handling referer and UA in URL if present with |
        clean_url = url.split('|')[0]
        headers = {'User-Agent': 'Mozilla/5.0'}
        if '|' in url:
            params = url.split('|')[1:]
            for p in params:
                if 'referer=' in p.lower():
                    headers['Referer'] = p.split('=')[1]
        
        r = requests.head(clean_url, headers=headers, timeout=10, allow_redirects=True)
        return r.status_code == 200
    except:
        return False

# 1. Fetch Data
channels, sha = get_github_file(JSON_FILE)
updated_channels = []
m3u_content = "#EXTM3U\n"

# 2. Check each channel
for ch in channels:
    print(f"Checking: {ch['name']}...")
    is_live = check_link(ch['url'])
    ch['status'] = "Online" if is_live else "Offline"
    updated_channels.append(ch)
    
    # 3. Add to M3U only if Online
    if is_live:
        m3u_content += f"#EXTINF:-1 tvg-logo=\"{ch['logo']}\" group-title=\"{ch['category']}\",{ch['name']}\n{ch['url']}\n"

# 4. Push updates
update_github_file(JSON_FILE, json.dumps(updated_channels, indent=2), sha, "Bot: Auto-status check")

# Push M3U (get current sha first)
_, m3u_sha = get_github_file(M3U_FILE)
update_github_file(M3U_FILE, m3u_content, m3u_sha, "Bot: Update playlist.m3u")

print("Sync Complete!")
