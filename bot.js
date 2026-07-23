const fs = require('fs');
const axios = require('axios');

/**
 * URL ভেরিফাই করার ফাংশন (টাইমআউট ১৫ সেকেন্ড এবং রিডাইরেক্ট ফলোসহ)
 */
async function checkUrl(url, retries = 2) {
  const cleanUrl = url.split('|')[0].trim();

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        method: 'get',
        url: cleanUrl,
        timeout: 15000,
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

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function runBot() {
  console.log("Starting NowshinTV Auto-Recovery Channel Bot...");

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

  for (let ch of channels) {
    ch.failCount = ch.failCount || 0;
    ch.successCount = ch.successCount || 0;

    // 🔒 সুরক্ষা: চ্যানেল যদি আগেই Online থাকে, বট সেটা কখনোই হাত দেবে না/অফলাইন করবে না!
    if (ch.status === "Online") {
      console.log(`[PROTECTED] ✅ ${ch.name} is Online. Bot will keep it Online.`);
      continue;
    }

    // 🔄 শুধুমাত্র Offline চ্যানেলগুলোর জন্য রিকভারি চেক চলবে
    const isLive = await checkUrl(ch.url);

    if (isLive) {
      ch.status = "Online"; // তৎক্ষণাৎ অনলাইন করবে
      ch.successCount = (ch.successCount || 0) + 1;
      ch.failCount = 0;
      console.log(`[RECOVERED] 🎉 ${ch.name} is live again! Status updated to ONLINE.`);
    } else {
      ch.failCount = (ch.failCount || 0) + 1;
      ch.successCount = 0;
      console.log(`[STILL OFFLINE] 🛑 ${ch.name} is down.`);
    }
  }

  // সিরিয়াল নম্বর অনুযায়ী সাজানো
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // channels.json সেভ
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // playlist.m3u প্লেলিস্ট আপডেট করা
  let m3uContent = "#EXTM3U\n\n";
  for (let ch of channels) {
    if (ch.status === "Online") {
      const logo = (ch.logo && ch.logo.trim() !== '') ? ch.logo : 'https://i.postimg.cc/gjD0MkRD/file-00000000c1087209a5fd6b04173ebd59-(2).png';
      m3uContent += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${ch.category || 'NOWSHIN'}",${ch.name}\n${ch.url}\n\n`;
    }
  }

  fs.writeFileSync('./playlist.m3u', m3uContent, 'utf8');
  console.log("Validation complete! Offline channels recovered & playlist updated.");
}

runBot();
