const fs = require("fs");
const https = require("https");
const http = require("http");
const { URL } = require("url");
const { Parser } = require("m3u8-parser");
const { execSync } = require("child_process");

const MAX_REDIRECTS = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY = 3000; 
const CONCURRENCY_LIMIT = 5; 

// Consecutive Logic Config
const CONSECUTIVE_FAIL_LIMIT = 3;
const CONSECUTIVE_SUCCESS_LIMIT = 2;
const SLOW_RESPONSE_THRESHOLD = 3000; // ৩ সেকেন্ডের বেশি হলে Slow

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// সিস্টেমে ffprobe আছে কিনা চেক করার ফাংশন
function hasFfprobe() {
  try {
    execSync("ffprobe -version", { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}
const IS_FFPROBE_AVAILABLE = hasFfprobe();

// উন্নত হেডার পার্সার (Fixes Bug #1)
function parseCustomHeaders(urlField) {
  let headers = { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "*/*"
  };
  if (!urlField.includes("|")) return { cleanUrl: urlField.trim(), headers };

  const parts = urlField.split("|");
  const cleanUrl = parts[0].trim();
  const headerString = parts[1];

  headerString.split("&").forEach(p => {
    const eqIdx = p.indexOf("=");
    if (eqIdx !== -1) {
      const key = p.substring(0, eqIdx).trim().toLowerCase();
      const val = p.substring(eqIdx + 1).trim();
      if (["referer", "user-agent", "cookie", "origin", "authorization"].includes(key)) {
        const formattedKey = key === "user-agent" ? "User-Agent" : key.charAt(0).toUpperCase() + key.slice(1);
        headers[formattedKey] = val;
      }
    }
  });
  return { cleanUrl, headers };
}

// কাস্টম এইচটিটিপি ক্লায়েন্ট (Fixes Bug #2, #6)
function httpRequest(targetUrl, headers, method = "GET", redirectCount = 0, originUrl = null) {
  return new Promise((resolve) => {
    if (redirectCount > MAX_REDIRECTS) {
      return resolve({ success: false, reason: "Too many redirects", statusCode: 310 });
    }

    let parsedUrl;
    try { parsedUrl = new URL(targetUrl); } catch (e) {
      return resolve({ success: false, reason: "Invalid URL", statusCode: 400 });
    }

    const client = parsedUrl.protocol === "https:" ? https : http;
    let currentHeaders = { ...headers };
    
    // ডোমেন পরিবর্তন হলে সিকিউরিটি হেডার বাদ দেওয়া (Fixes Bug #6)
    if (originUrl) {
      try {
        const orig = new URL(originUrl);
        if (orig.hostname !== parsedUrl.hostname) {
          delete currentHeaders["Authorization"];
          delete currentHeaders["Cookie"];
        }
      } catch(e){}
    }
    currentHeaders["host"] = parsedUrl.hostname;

    const reqOptions = {
      method: method,
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      headers: currentHeaders,
      timeout: 8000 
    };

    const startTime = Date.now();

    const req = client.request(reqOptions, (res) => {
      // স্মার্ট রিডাইরেক্ট হ্যান্ডলার
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith("http")) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        return resolve(httpRequest(redirectUrl, headers, method, redirectCount + 1, originUrl || targetUrl));
      }

      if (method === "HEAD") {
        return resolve({ 
          success: res.statusCode >= 200 && res.statusCode < 400, 
          statusCode: res.statusCode, 
          headers: res.headers,
          responseTime: Date.now() - startTime 
        });
      }

      let chunks = [];
      let totalBytes = 0;
      res.on("data", (chunk) => { 
        chunks.push(chunk); 
        totalBytes += chunk.length;
        // বড় লাইভ মেনিফেস্টের ক্ষেত্রে প্রথম ৫০ KB আসলেই রিড থামিয়ে দেওয়া (Fixes Bug #7)
        if (totalBytes > 51200) { 
          req.destroy();
        }
      });
      
      res.on("end", () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          responseTime: Date.now() - startTime
        });
      });
    });

    req.on("error", (e) => resolve({ success: false, reason: "Network: " + e.message, statusCode: 500 }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, reason: "Timeout", statusCode: 408 }); });
    req.end();
  });
}

// HEAD Fallback মেকানিজম (Fixes Bug #2)
async function safeRequest(url, headers, method = "HEAD") {
  let res = await httpRequest(url, headers, method);
  // HEAD মেথড ফেইল করলে কিন্তু সেটি নেটওয়ার্ক ডেড না হলে, GET দিয়ে রিট্রাই করবে
  if (!res.success && method === "HEAD" && [403, 404, 405, 501].includes(res.statusCode)) {
    res = await httpRequest(url, headers, "GET");
  }
  return res;
}

// ffprobe রিয়েল প্লেব্যাক ভেরিফায়ার (Fixes Bug #3)
function verifyWithFfprobe(url, headers) {
  return new Promise((resolve) => {
    let headerStr = Object.keys(headers).map(k => `${k}: ${headers[k]}`).join("\r\n");
    // ffprobe কে মাত্র ৫ সেকেন্ড সময় দেওয়া হবে রিয়েল ডিকোড ডেটা এনালাইসিসের জন্য
    const cmd = `ffprobe -v error -headers "${headerStr.replace(/"/g, '\\"')}" -show_entries format=format_name -of default=noprint_wrappers=1 "${url.split("|")[0]}"`;
    
    const startTime = Date.now();
    require("child_process").exec(cmd, { timeout: 6000 }, (err, stdout, stderr) => {
      const responseTime = Date.now() - startTime;
      if (!err && stdout.includes("format_name")) {
        resolve({ isLive: true, responseTime });
      } else {
        resolve({ isLive: false, reason: "ffprobe: Decode failed", responseTime });
      }
    });
  });
}

// ট্রু প্লেব্যাক এবং মিডিয়া সেগমেন্ট চেকার
async function verifyStream(url, headers) {
  // যদি ffprobe থাকে, তা দিয়ে সরাসরি রিয়েল ডিকোড চেক করা হবে (Fixes Bug #3)
  if (IS_FFPROBE_AVAILABLE) {
    return await verifyWithFfprobe(url, headers);
  }

  // Fallback: মেনিফেস্ট পার্সিং মেথড (যদি ffprobe না থাকে)
  const manifestRes = await safeRequest(url, headers, "GET");
  if (!manifestRes.success || !manifestRes.body) {
    return { isLive: false, reason: manifestRes.reason || `HTTP ${manifestRes.statusCode}`, responseTime: manifestRes.responseTime || 0 };
  }

  const bufferStr = manifestRes.body.toString();
  const lowerBuffer = bufferStr.toLowerCase();

  if (lowerBuffer.includes("<!doctype html") || lowerBuffer.includes("<html") || lowerBuffer.includes("access denied")) {
    return { isLive: false, reason: "Fake HTML/Access Denied page", responseTime: manifestRes.responseTime };
  }

  if (!bufferStr.includes("#EXTM3U")) {
    if (manifestRes.statusCode === 200 && manifestRes.body.length > 500) {
      return { isLive: true, responseTime: manifestRes.responseTime }; 
    }
    return { isLive: false, reason: "Not a valid M3U8 manifest", responseTime: manifestRes.responseTime };
  }

  try {
    const parser = new Parser();
    parser.push(bufferStr);
    parser.end();

    if (parser.manifest.segments && parser.manifest.segments.length > 0) {
      let firstSegmentUri = parser.manifest.segments[0].uri;
      if (!firstSegmentUri.startsWith("http")) {
        const { cleanUrl } = parseCustomHeaders(url);
        firstSegmentUri = new URL(firstSegmentUri, cleanUrl).href;
      }
      
      const segmentRes = await safeRequest(firstSegmentUri, headers, "HEAD");
      if (segmentRes.success) {
        return { isLive: true, responseTime: manifestRes.responseTime + (segmentRes.responseTime || 0) };
      } else {
        return { isLive: false, reason: `Media segment unreachable (${segmentRes.statusCode})`, responseTime: manifestRes.responseTime };
      }
    } 
    else if (parser.manifest.playlists && parser.manifest.playlists.length > 0) {
      let subUrl = parser.manifest.playlists[0].uri;
      if (!subUrl.startsWith("http")) {
        const { cleanUrl } = parseCustomHeaders(url);
        subUrl = new URL(subUrl, cleanUrl).href;
      }
      return await verifyStream(subUrl, headers); 
    }
    return { isLive: false, reason: "Empty segments/playlists", responseTime: manifestRes.responseTime };
  } catch (err) {
    return { isLive: false, reason: "M3U8 Parsing failed", responseTime: manifestRes.responseTime };
  }
}

// রিট্রাই এবং টাইম মেজারমেন্টসহ রানার (Fixes Bug #8)
async function checkUrlWithRetry(url) {
  const { cleanUrl, headers } = parseCustomHeaders(url);
  let lastReason = "";
  let totalResponseTime = 0;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    let result = await verifyStream(url, headers);
    if (result.isLive) {
      return { isLive: true, responseTime: result.responseTime };
    }
    lastReason = result.reason;
    totalResponseTime = result.responseTime || 0;
    if (i < MAX_RETRIES) await sleep(RETRY_DELAY);
  }
  return { isLive: false, reason: lastReason, responseTime: totalResponseTime };
}

// কনকারেন্সি কন্ট্রোলার পুল
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

// প্রধান স্টার্ট ফাংশন
async function start() {
  if (!fs.existsSync("channels.json")) {
    fs.writeFileSync("channels.json", JSON.stringify([], null, 2));
    return;
  }
  
  let channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
  let isStateChanged = false; // Rewrite Fix এর জন্য ফ্ল্যাগ (Fixes Bug #5)
  
  console.log(`Checking ${channels.length} channels with Concurrency Limit: ${CONCURRENCY_LIMIT}...`);
  console.log(`Playback Validation Mode: ${IS_FFPROBE_AVAILABLE ? "FFPROBE (Full Decode)" : "Network Manifest Parsing"}`);

  await asyncPool(CONCURRENCY_LIMIT, channels, async (ch) => {
    // ইনিশিয়াল ট্র্যাকার সেটআপ
    if (ch.failCount === undefined) ch.failCount = 0;
    if (ch.successCount === undefined) ch.successCount = 0;
    
    let checkResult = await checkUrlWithRetry(ch.url);
    let oldStatus = ch.status || "Offline";
    let calculatedStatus = oldStatus;

    if (checkResult.isLive) {
      ch.successCount++;
      ch.failCount = 0; // সফল হলে ফেইল কাউন্ট রিসেট
      
      // Consecutive Success Logic (Fixes Bug #4)
      if (ch.successCount >= CONSECUTIVE_SUCCESS_LIMIT || oldStatus.startsWith("Online")) {
        // রেসপন্স স্পীড ক্যালকুলেশন (Fixes Bug #8)
        calculatedStatus = checkResult.responseTime > SLOW_RESPONSE_THRESHOLD ? "Online (Slow)" : "Online (Fast)";
      }
    } else {
      ch.failCount++;
      ch.successCount = 0; // ব্যর্থ হলে সাকসেস কাউন্ট রিসেট
      
      // Consecutive Fail Logic (Fixes Bug #4)
      if (ch.failCount >= CONSECUTIVE_FAIL_LIMIT) {
        calculatedStatus = "Offline";
      }
    }

    if (ch.status !== calculatedStatus) {
      console.log(`Status Changed: [${ch.name}] (${ch.status || "None"} -> ${calculatedStatus}) | Reason: ${checkResult.reason || "Success"} (${checkResult.responseTime}ms)`);
      ch.status = calculatedStatus;
      isStateChanged = true;
    }
  });

  // স্মার্ট প্লেলিস্ট এবং ডেটাবেস জেনারেটর (Fixes Bug #5)
  if (isStateChanged || !fs.existsSync("playlist.m3u")) {
    let m3u = "#EXTM3U\n";
    channels.forEach(ch => {
      if (ch.status && ch.status.startsWith("Online")) {
        const { cleanUrl, headers } = parseCustomHeaders(ch.url);
        let extra = "";
        
        // হেডার রি-বিল্ড প্লেলিস্ট ফরম্যাটের জন্য
        Object.keys(headers).forEach(k => {
          if (["Referer", "User-Agent", "Cookie", "Origin", "Authorization"].includes(k)) {
            extra += `|${k}=${headers[k]}`;
          }
        });
        
        m3u += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.category}",${ch.name}\n${cleanUrl}${extra}\n`;
      }
    });

    fs.writeFileSync("playlist.m3u", m3u);
    fs.writeFileSync("channels.json", JSON.stringify(channels, null, 2));
    console.log("Database & Playlist rewritten due to updates.");
  } else {
    console.log("No status changes detected. File rewrite skipped (Dry-run optimized).");
  }
}

start();
