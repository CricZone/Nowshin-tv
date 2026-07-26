const fs = require('fs');
const axios = require('axios');

/**
 * URL ভেরিফাই করার ফাংশন
 */
async function checkUrl(url, retries = 1) {
  const cleanUrl = url.split('|')[0].trim();

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        method: 'get',
        url: cleanUrl,
        timeout: 10000,
        maxRedirects: 5,
        responseType: 'stream', // পুরো ভিডিও ডাউনলোড না করে শুধু স্ট্রিম রেসপন্স চেক করার জন্য
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        validateStatus: (status) => status >= 200 && status < 400
      });

      // স্ট্রিম কানেকশন পাওয়ার পর পরই ডেটা পড়া বাতিল করা যাতে মেমোরি খালি থাকে
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }

      return true;
    } catch (error) {
      // ৪০৩ বা ৪০৫ রেসপন্স অনেক সময় টোকেন/ইউজার-এজেন্ট সুরক্ষার কারণে আসে, যা ব্রাউজার/টিভিতে কাজ করতে পারে
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
  console.log("Starting NowshinTV Health Check Bot...");

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

    // সব চ্যানেল লাইভ আছে কিনা যাচাই করা হচ্ছে
    const isLive = await checkUrl(ch.url);

    if (isLive) {
      if (ch.status !== "Online") {
        console.log(`[RECOVERED] 🎉 ${ch.name} is now Online!`);
      } else {
        console.log(`[ONLINE] ${ch.name} is working.`);
      }
      ch.status = "Online";
      ch.failCount = 0;
      ch.successCount += 1;
    } else {
      ch.failCount += 1;
      
      // পরপর ২ বার ফেল করলে চ্যানেলটি অফলাইন মার্ক করা হবে (যাতে সাময়িক নেটওয়ার্ক সমস্যায় ভুল অফলাইন না হয়)
      if (ch.failCount >= 2 || ch.status === "Offline") {
        if (ch.status === "Online") {
          console.log(`[OFFLINE] ❌ ${ch.name} is down and set to Offline.`);
        } else {
          console.log(`[STILL OFFLINE] ❌ ${ch.name}`);
        }
        ch.status = "Offline";
      } else {
        console.log(`[WARNING] ⚠️ ${ch.name} failed 1 check. Retrying next cycle.`);
      }
    }
  }

  // সিরিয়াল নম্বর অনুযায়ী সাজানো
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // channels.json আপডেট
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // শুধুমাত্র চালু (Online) চ্যানেলগুলো নিয়ে playlist.m3u তৈরি করা
  let m3uContent = "#EXTM3U\n\n";
  for (let ch of channels) {
    if (ch.status === "Online") {
      const logo = ch.logo && ch.logo.trim() !== '' ? ch.logo : 'https://i.postimg.cc/gjD0MkRD/file-00000000c1087209a5fd6b04173ebd59-(2).png';
      m3uContent += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${ch.category || 'NOWSHIN'}",${ch.name}\n${ch.url}\n\n`;
    }
  }

  fs.writeFileSync('./playlist.m3u', m3uContent, 'utf8');
  console.log("Validation complete.");
}

runBot();
