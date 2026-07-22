const fs = require('fs');
const axios = require('axios');

/**
 * URL ভেরিফাই করার ফাংশন (টাইমআউট ২০ সেকেন্ড এবং রিডাইরেক্ট ফলোসহ)
 */
async function checkUrl(url, retries = 2) {
  const cleanUrl = url.split('|')[0].trim();

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        method: 'get',
        url: cleanUrl,
        timeout: 20000, // ৪. টাইমআউট ২০ সেকেন্ড করা হলো
        maxRedirects: 10, // ৫. Max Redirects ১০ করা হলো
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        validateStatus: (status) => status >= 200 && status < 400
      });
      return true;
    } catch (error) {
      // যদি ৪০৩ বা ৪০৫ রেসপন্স দেয়, সেক্ষেত্রে সংকেত সক্রিয় থাকলে অনলাইন ধরা হবে
      if (error.response && (error.response.status === 403 || error.response.status === 405)) {
        return true;
      }

      if (i === retries) {
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  return false;
}

async function runBot() {
  console.log("Starting NowshinTV Advanced Channel Health Check Bot...");

  if (!fs.existsSync('./channels.json')) {
    console.error("channels.json file not found!");
    return;
  }

  const rawData = fs.readFileSync('./channels.json', 'utf8');
  let channels;
  try {
    channels = JSON.parse(rawData);
  } catch (e) {
    console.error("Error parsing channels.json file!");
    return;
  }

  let onlineCount = 0;

  for (let ch of channels) {
    const isLive = await checkUrl(ch.url);

    // ১ & ৩. failCount ও successCount হ্যান্ডলিং এবং টানা চেকিং লজিক
    ch.failCount = ch.failCount || 0;
    ch.successCount = ch.successCount || 0;

    if (isLive) {
      ch.successCount++;
      ch.failCount = 0;

      // টানা ২ বার সফল হলে Online
      if (ch.successCount >= 2) {
        ch.status = "Online";
      }

      if (ch.status === "Online") {
        onlineCount++;
      }
    } else {
      ch.failCount++;
      ch.successCount = 0;

      // টানা ৪ বার ফেল করলে Offline
      if (ch.failCount >= 4) {
        ch.status = "Offline";
      }
    }

    console.log(`Verified ${ch.name} -> Status: ${ch.status} (Success: ${ch.successCount}, Fail: ${ch.failCount})`);
  }

  // নেটওয়ার্ক ফেইলিওর সেফটি
  if (onlineCount === 0 && channels.length > 0) {
    console.log("[Warning] Critical network/internet failure detected. Skipping file writes to protect channels.");
    return;
  }

  // সিরিয়াল নম্বর অনুযায়ী সাজানো
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // channels.json আপডেট
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // playlist.m3u প্লেলিস্ট তৈরি
  let m3uContent = "#EXTM3U\n\n";
  for (let ch of channels) {
    if (ch.status === "Online") {
      m3uContent += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.category}",${ch.name}\n${ch.url}\n\n`;
    }
  }

  fs.writeFileSync('./playlist.m3u', m3uContent, 'utf8');
  console.log("Validation complete. channels.json and playlist.m3u updated.");
}

runBot();
