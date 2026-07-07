# 📺 NowshinTV Stream Unit - Admin Panel & Auto-Bot

A modern, light, and premium admin control panel to manage live streaming IPTV channels for NowshinTV. This architecture is entirely serverless, database-free, and powered completely by **GitHub Core API** and **GitHub Actions (Cron Jobs)**. No third-party servers or Google Apps Scripts required.

---

## 🚀 Key Features

- ⚡ **Instant Rendering:** Zero loading lags because metadata is parsed instantly directly from GitHub CDN.
- 🤖 **15-Min Automated Bot:** An automated cron job workflow runs every 15 minutes to verify all media endpoints sequentially.
- 🟢🔴 **Smart Status Engine:** Channels that are down get toggled to `Offline` and are dynamically hidden from the deployment playlist. Once they resume, they automatically flip to `Online` and sync right back.
- 🔄 **Sequential Auto Serial Shift:** Inserting or positioning a custom configuration automatically moves all trailing indices cleanly down by one increment.
- 🔗 **Premium Stream Headers Support:** Flawlessly maps and parses premium tokens, parameters, and stream headers (`|referer=...&User-Agent=...`) straight into the output stream.
- 📱 **Televizo Ready:** Generates structural and validated standard `.m3u` formats natively recognized by Televizo Player and cross-platform IPTV applications.
- ✨ **Premium UX & PWA Support:** Built on sleek dark-mode layouts, full SVG assets, fluid transitions, and a fully functional Progressive Web App installation banner.

---

## 📂 Repository Tree

The main repository comprises three fundamental components:

1. **`index.html`** - Premium Admin Dashboard Management Client.
2. **`channels.json`** - System's localized JSON database engine containing attributes and statuses.
3. **`.github/workflows/checker.yml`** - Core background service workflow validation task.

---

## 🛠️ Operational Architecture

