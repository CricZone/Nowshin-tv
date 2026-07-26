/**
==========================================================
NOWSHIN TV - Professional IPTV Health Checker v2.5
Updated to handle M3U8, TS, MP4, Custom Headers, Referer & Cookies
==========================================================
*/

const fs = require("fs");
const axios = require("axios");
const { Parser } = require("m3u8-parser");
const pLimit = require("p-limit");
const { spawn } = require("child_process");

// ----------------------------------------------------
// CONFIG
// ----------------------------------------------------
const CONFIG = {
  CHANNEL_FILE: "./channels.json",
  PLAYLIST_FILE: "./playlist.m3u",
  
  REQUEST_TIMEOUT: 15000,
  MAX_REDIRECTS: 10,
  MAX_RETRIES: 2,
  RETRY_DELAY: 1500,
  
  FAIL_LIMIT: 3,
  SUCCESS_LIMIT: 1,
  CONCURRENCY: 5,
  
  FFPROBE_TIMEOUT: 15000,
  DEFAULT_LOGO: "https://i.postimg.cc/gjD0MkRD/file-00000000c1087209a5fd6b04173ebd59-(2).png",
  
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

const limit = pLimit(CONFIG.CONCURRENCY);

function log(type, message) {
  const now = new Date().toISOString();
  console.log(`[${now}] [${type}] ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * URL এবং সংযুক্ত Custom Headers (যেমন: |User-Agent=...&Referer=...) আলাদা করার স্মাট মেথড
 */
function parseUrlAndHeaders(rawUrl) {
  if (!rawUrl) return { url: "", headers: {} };
  
  const parts = rawUrl.split("|");
  const cleanUrl = parts[0].trim();
  const headers = {
    "User-Agent": CONFIG.USER_AGENT,
    "Accept": "*/*",
    "Connection": "keep-alive"
  };

  if (parts.length > 1) {
    const headerString = parts[1].trim();
    const params = new URLSearchParams(headerString);
    for (const [key, val] of params.entries()) {
      headers[key] = val;
    }
  }

  // Auto Referer baseline if not set
  if (!headers["Referer"] && !headers["referer"]) {
    try {
      const parsed = new URL(cleanUrl);
      headers["Referer"] = `${parsed.protocol}//${parsed.hostname}/`;
    } catch (e) {
      // Ignore URL parse error
    }
  }

  return { url: cleanUrl, headers };
}

function loadChannels() {
  if (!fs.existsSync(CONFIG.CHANNEL_FILE)) {
    throw new Error("channels.json not found.");
  }
  return JSON.parse(fs.readFileSync(CONFIG.CHANNEL_FILE, "utf8"));
}

function saveChannels(channels) {
  fs.writeFileSync(CONFIG.CHANNEL_FILE, JSON.stringify(channels, null, 2), "utf8");
}

/**
 * Smart Request Engine (With Cookie & Redirect Tracking)
 */
async function smartRequest(rawUrl) {
  const { url, headers } = parseUrlAndHeaders(rawUrl);
  let lastError = null;

  for (let i = 1; i <= CONFIG.MAX_RETRIES; i++) {
    try {
      const response = await axios({
        method: "GET",
        url: url,
        timeout: CONFIG.REQUEST_TIMEOUT,
        maxRedirects: CONFIG.MAX_REDIRECTS,
        headers: headers,
        responseType: "text",
        validateStatus: () => true
      });

      const status = response.status;
      if (status >= 200 && status < 400) {
        return { response, headers, originalUrl: url };
      }
      
      lastError = new Error(`HTTP ${status}`);
    } catch (err) {
      lastError = err;
    }

    if (i < CONFIG.MAX_RETRIES) {
      await sleep(CONFIG.RETRY_DELAY);
    }
  }
  throw lastError;
}

function isHtml(body) {
  if (!body) return false;
  const text = body.trim().toLowerCase();
  return text.startsWith("<!doctype html") || text.startsWith("<html");
}

function parsePlaylist(text) {
  const parser = new Parser();
  parser.push(text);
  parser.end();
  return parser.manifest;
}

function isMasterPlaylist(manifest) {
  return manifest && Array.isArray(manifest.playlists) && manifest.playlists.length > 0;
}

function isMediaPlaylist(manifest) {
  return manifest && Array.isArray(manifest.segments) && manifest.segments.length > 0;
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

/**
 * FFprobe Validation (Supports custom headers, referer, user-agent, cookies)
 */
function runFFprobe(targetUrl, headers = {}) {
  return new Promise((resolve) => {
    let headerStr = "";
    for (const [key, value] of Object.entries(headers)) {
      headerStr += `${key}: ${value}\r\n`;
    }

    const args = [
      "-v", "error",
      "-headers", headerStr,
      "-user_agent", headers["User-Agent"] || CONFIG.USER_AGENT,
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,codec_type",
      "-of", "json",
      targetUrl
    ];

    const proc = spawn("ffprobe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, reason: "FFprobe Timeout" });
    }, CONFIG.FFPROBE_TIMEOUT);

    proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
    proc.stderr.on("data", chunk => { stderr += chunk.toString(); });

    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({ ok: false, reason: stderr.trim() || `Exit Code ${code}` });
      }
      try {
        const json = JSON.parse(stdout);
        if (json.streams && json.streams.length > 0) {
          return resolve({ ok: true, streams: json.streams });
        }
        resolve({ ok: false, reason: "No Video Stream Found" });
      } catch {
        resolve({ ok: false, reason: "Invalid FFprobe JSON" });
      }
    });
  });
}

/**
 * Comprehensive Channel Validation (M3U8 / Direct TS / Direct MP4)
 */
async function validateChannel(channel) {
  channel.failCount = Number(channel.failCount || 0);
  channel.successCount = Number(channel.successCount || 0);

  try {
    log("CHECK", channel.name);
    const { url: cleanUrlStr, headers } = parseUrlAndHeaders(channel.url);
    const lowerUrl = cleanUrlStr.toLowerCase();

    // Case 1: Direct TS or Direct MP4 streams
    if (lowerUrl.includes(".ts") || lowerUrl.includes(".mp4") || lowerUrl.includes("/live/")) {
      const probe = await runFFprobe(cleanUrlStr, headers);
      if (probe.ok) {
        channel.successCount++;
        channel.failCount = 0;
        if (channel.successCount >= CONFIG.SUCCESS_LIMIT) channel.status = "Online";
        log("ONLINE", `${channel.name} (Direct Stream Validated)`);
        return channel;
      }
    }

    // Case 2: M3U8 Playlist Analysis
    const reqResult = await smartRequest(channel.url);
    const body = String(reqResult.response.data || "");

    if (isHtml(body)) {
      throw new Error("HTML Response Received (Stream Blocked/Expired)");
    }

    let targetSegment = cleanUrlStr;

    if (body.includes("#EXTM3U")) {
      const manifest = parsePlaylist(body);
      const finalUrl = reqResult.response.request?.res?.responseUrl || cleanUrlStr;

      if (isMediaPlaylist(manifest)) {
        targetSegment = resolveUrl(finalUrl, manifest.segments[0].uri);
      } else if (isMasterPlaylist(manifest)) {
        const topVariant = manifest.playlists.sort((a, b) => (b.attributes?.BANDWIDTH || 0) - (a.attributes?.BANDWIDTH || 0))[0];
        if (topVariant) {
          const mediaPlaylistUrl = resolveUrl(finalUrl, topVariant.uri);
          const subReq = await smartRequest(mediaPlaylistUrl);
          const subManifest = parsePlaylist(String(subReq.response.data || ""));
          if (isMediaPlaylist(subManifest)) {
            targetSegment = resolveUrl(mediaPlaylistUrl, subManifest.segments[0].uri);
          }
        }
      }
    }

    // Validate Stream Chunk via FFprobe
    const probe = await runFFprobe(targetSegment, headers);
    
    if (probe.ok) {
      channel.successCount++;
      channel.failCount = 0;
      if (channel.successCount >= CONFIG.SUCCESS_LIMIT) {
        channel.status = "Online";
      }
      log("ONLINE", `${channel.name} (Stream Active)`);
    } else {
      channel.failCount++;
      channel.successCount = 0;
      if (channel.failCount >= CONFIG.FAIL_LIMIT) {
        channel.status = "Offline";
      }
      log("OFFLINE", `${channel.name} (${probe.reason})`);
    }

  } catch (err) {
    channel.failCount++;
    channel.successCount = 0;
    if (channel.failCount >= CONFIG.FAIL_LIMIT) {
      channel.status = "Offline";
    }
    log("ERROR", `${channel.name} : ${err.message}`);
  }

  return channel;
}

async function validateAllChannels(channels) {
  const jobs = channels.map(channel => limit(() => validateChannel(channel)));
  const result = await Promise.all(jobs);
  result.sort((a, b) => Number(a.serial || 0) - Number(b.serial || 0));
  return result;
}

function generatePlaylist(channels) {
  let output = "#EXTM3U\n\n";
  const online = channels
    .filter(c => c.status === "Online")
    .sort((a, b) => Number(a.serial || 0) - Number(b.serial || 0));

  for (const ch of online) {
    const logo = (ch.logo && ch.logo.trim()) || CONFIG.DEFAULT_LOGO;
    const group = (ch.category && ch.category.trim()) || "NOWSHIN";
    output += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${group}",${ch.name}\n${ch.url}\n\n`;
  }

  fs.writeFileSync(CONFIG.PLAYLIST_FILE, output, "utf8");
  log("PLAYLIST", `${online.length} channels written.`);
}

function printSummary(channels) {
  const total = channels.length;
  const online = channels.filter(c => c.status === "Online").length;
  const offline = total - online;

  console.log("");
  console.log("========================================");
  console.log(" NOWSHIN TV IPTV HEALTH REPORT");
  console.log("========================================");
  console.log(` Total   : ${total}`);
  console.log(` Online  : ${online}`);
  console.log(` Offline : ${offline}`);
  console.log("========================================");
}

async function runBot() {
  log("BOT", "Professional IPTV Health Checker Started");
  let channels = loadChannels();
  channels = await validateAllChannels(channels);
  saveChannels(channels);
  generatePlaylist(channels);
  printSummary(channels);
  log("DONE", "Validation Finished Successfully");
}

runBot()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
