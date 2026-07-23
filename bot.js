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
  console.log("Starting NowshinTV Smart Channel Validation & Recovery Bot...");

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

    const isLive = await checkUrl(ch.url);

    if (isLive) {
      ch.successCount++;
      ch.failCount = 0;

      // যদি অফলাইন থাকে এবং টানা ২ বার সফল হয় -> অনলাইন করবে
      if (ch.status === "Offline" && ch.successCount >= 2) {
        ch.status = "Online";
        console.log(`[RECOVERED] 🎉 ${ch.name} is back live -> Status changed to ONLINE`);
      } else if (ch.status === "Online") {
        console.log(`[ACTIVE] ✅ ${ch.name} is working properly.`);
      } else {
        console.log(`[RECOVERING] ⏳ ${ch.name} responded (${ch.successCount}/2 verification steps)`);
      }

    } else {
      ch.failCount++;
      ch.successCount = 0;

      // যদি অনলাইন থাকে এবং টানা ২ বার ফেল করে -> অফলাইন করবে
      if (ch.status === "Online" && ch.failCount >= 2) {
        ch.status = "Offline";
        console.log(`[DOWN] ❌ ${ch.name} stopped working -> Status changed to OFFLINE`);
      } else if (ch.status === "Offline") {
        console.log(`[INACTIVE] 🛑 ${ch.name} is still offline.`);
      } else {
        console.log(`[WARNING] ⚠️ ${ch.name} failed once (${ch.failCount}/2). Re-checking in next run...`);
      }
    }
  }

  // সিরিয়াল অনুযায়ী সাজানো
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // channels.json সেভ করা
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // playlist.m3u তৈরি করা (শুধুমাত্র সত্যি Online চ্যানেল যাবে)
  let m3uContent = "#EXTM3U\n\n";
  for (let ch of channels) {
    if (ch.status === "Online") {
      const logo = (ch.logo && ch.logo.trim() !== '') ? ch.logo : 'https://i.postimg.cc/gjD0MkRD/file-00000000c1087209a5fd6b04173ebd59-(2).png';
      m3uContent += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${ch.category || 'NOWSHIN'}",${ch.name}\n${ch.url}\n\n`;
    }
  }

  fs.writeFileSync('./playlist.m3u', m3uContent, 'utf8');
  console.log("Validation complete! playlist.m3u updated with active working channels only.");
}

runBot();
