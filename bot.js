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
        timeout: 20000,
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        validateStatus: (status) => status >= 200 && status < 400
      });
      return true;
    } catch (error) {
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
  console.log("Starting NowshinTV Safe Health Check Bot...");

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

    ch.failCount = ch.failCount || 0;
    ch.successCount = ch.successCount || 0;

    if (isLive) {
      ch.successCount++;
      ch.failCount = 0;
    } else {
      ch.failCount++;
      ch.successCount = 0;
    }

    // গুরুত্বপূর্ণ পরিবর্তন:
    // বট চ্যানেলকে স্বয়ংক্রিয়ভাবে 'Online' বা 'Offline' ফোর্সবিক্রেডিট করবে না।
    // চ্যানেল পূর্বে যে স্ট্যাটাসে (Online/Offline) ছিল, সেটিই স্থায়ীভাবে থাকবে।
    if (ch.status === "Online") {
      onlineCount++;
    }

    console.log(`Checked ${ch.name} -> Maintained Status: ${ch.status} (Live Check: ${isLive ? 'PASS' : 'FAIL'})`);
  }

  // সিরিয়াল নম্বর অনুযায়ী সাজানো
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // channels.json আপডেট
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // শুধুমাত্র পূর্বে Online নির্ধারিত থাকা চ্যানেলগুলি নিয়েই প্লেলিস্ট তৈরি হবে
  let m3uContent = "#EXTM3U\n\n";
  for (let ch of channels) {
    if (ch.status === "Online") {
      m3uContent += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.category}",${ch.name}\n${ch.url}\n\n`;
    }
  }

  fs.writeFileSync('./playlist.m3u', m3uContent, 'utf8');
  console.log("Validation complete. Channels status preserved successfully.");
}

runBot();
