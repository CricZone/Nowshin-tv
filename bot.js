const fs = require('fs');
const axios = require('axios');

/**
 * URL এবং HLS Stream চেক করার ফাংশন
 */
async function checkUrl(url, retries = 2) {
  // Pipes/Headers আলাদা করা (যদি URL এ | চিহ্ন থাকে)
  const cleanUrl = url.split('|')[0].trim();

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        method: 'get',
        url: cleanUrl,
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        validateStatus: (status) => status === 200 // শুধুমাত্র ২০০ স্ট্যাটাস কোড থাকলে ওকে
      });

      // m3u8 স্ট্রিম বা ভিডিও কনটেন্টের বেসিক ভ্যালিডেশন
      if (cleanUrl.includes('.m3u8')) {
        const data = String(response.data);
        // মেনিফেস্ট ফাইলে #EXTM3U অথবা #EXTINF থাকতে হবে
        if (data.includes('#EXTM3U') || data.includes('#EXTINF')) {
          return true;
        } else {
          return false; // রেসপন্স আসছে কিন্তু প্লেলিস্ট ডেটা নেই (লোডিং আটকে থাকবে)
        }
      }

      return true; // অন্যান্য সাধারণ ইউআরএল এর জন্য

    } catch (error) {
      if (i === retries) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return false;
}

async function runBot() {
  console.log("Starting NowshinTV Dynamic Channel Validator...");

  if (!fs.existsSync('./channels.json')) {
    console.error("channels.json file not found!");
    return;
  }

  let rawData;
  try {
    rawData = fs.readFileSync('./channels.json', 'utf8');
  } catch (e) {
    console.error("Error reading channels.json!");
    return;
  }

  let channels;
  try {
    channels = JSON.parse(rawData);
  } catch (e) {
    console.error("Error parsing channels.json file!");
    return;
  }

  const MAX_FAILURES = 2; // টানা ২ বার ফেল করলে চ্যানেল অফলাইন হিসেবে গণ্য হবে

  for (let ch of channels) {
    ch.failCount = ch.failCount || 0;
    ch.successCount = ch.successCount || 0;

    console.log(`Checking: ${ch.name}...`);
    const isLive = await checkUrl(ch.url);

    if (isLive) {
      ch.status = "Online";
      ch.failCount = 0;
      ch.successCount++;
      console.log(`  [ONLINE] ✅ ${ch.name} is streaming fine.`);
    } else {
      ch.failCount++;
      console.log(`  [WARNING] ⚠️ ${ch.name} failed check (${ch.failCount}/${MAX_FAILURES})`);

      // নির্দিষ্ট সংখ্যক বার ফেল করলেই কেবল অফলাইন করা হবে
      if (ch.failCount >= MAX_FAILURES) {
        ch.status = "Offline";
        console.log(`  [OFFLINE] ❌ ${ch.name} set to Offline!`);
      }
    }
  }

  // সিরিয়াল নম্বর অনুযায়ী সাজানো
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // channels.json ফাইল আপডেট করা
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // শুধুমাত্র আসল ONLINE চ্যানেলগুলো দিয়েই প্লেলিস্ট তৈরি করা
  let m3uContent = "#EXTM3U\n\n";
  let onlineCount = 0;

  for (let ch of channels) {
    if (ch.status === "Online") {
      onlineCount++;
      const logo = ch.logo && ch.logo.trim() !== '' 
        ? ch.logo 
        : 'https://i.postimg.cc/gjD0MkRD/file-00000000c1087209a5fd6b04173ebd59-(2).png';
        
      m3uContent += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${ch.category || 'NOWSHIN'}",${ch.name}\n${ch.url}\n\n`;
    }
  }

  fs.writeFileSync('./playlist.m3u', m3uContent, 'utf8');
  console.log(`Validation complete. Active channels in M3U: ${onlineCount}/${channels.length}`);
}

runBot();
