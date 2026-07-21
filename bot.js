const fs = require('fs');
const axios = require('axios');

// একটি নির্দিষ্ট URL চেক করার ফাংশন (Retry লজিকসহ)
async function checkUrl(url, retries = 2) {
  const cleanUrl = url.split('|')[0].trim();
  
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        method: 'get',
        url: cleanUrl,
        timeout: 10000, // টাইমআউট বাড়িয়ে ১০ সেকেন্ড করা হলো
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Range': 'bytes=0-1024'
        },
        validateStatus: (status) => status >= 200 && status < 400
      });
      return true; // সফল হলে true রিটার্ন করবে
    } catch (error) {
      // যদি ৪৩ বা ৪০৫ হয়, তবে সাথে সাথে অনলাইন ধরে নেব
      if (error.response && (error.response.status === 403 || error.response.status === 405)) {
        return true;
      }
      
      // যদি শেষ চেষ্টাটিও ফেইল করে, তবে লুপ শেষ করে নিচের দিকে যাবে
      if (i === retries) {
        // নেটওয়ার্ক পুরোপুরি অফলাইন থাকলে axios-এর error.code 'ENOTFOUND' বা 'ETIMEDOUT' হতে পারে
        if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          console.log(`[Network Error] No internet connection detected for ${cleanUrl}`);
        }
        return false;
      }
      
      // পরবর্তী চেষ্টার আগে ১ সেকেন্ড অপেক্ষা করবে
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function runBot() {
  console.log("Starting NowshinTV background channel validation...");
  
  if (!fs.existsSync('./channels.json')) {
    console.error("channels.json file not found!");
    return;
  }

  const rawData = fs.readFileSync('./channels.json', 'utf8');
  let channels;
  try {
    channels = JSON.parse(rawData);
  } catch (e) {
    console.error("Error parsing channels.json. File might be corrupted.");
    return;
  }

  let onlineCount = 0;

  for (let ch of channels) {
    const isLive = await checkUrl(ch.url);
    
    // যদি আপনার নিজের ইন্টারনেট অফ থাকে, তবে হুট করে সব চ্যানেল অফলাইন হওয়া থেকে বাঁচাতে এই শর্ত দিতে পারেন:
    // কিন্তু যদি ইন্টারনেট থাকে এবং শুধু ওই চ্যানেল অফলাইন হয়, তবেই অফলাইন হবে।
    if (isLive) {
      ch.status = "Online";
      onlineCount++;
    } else {
      // আগের স্ট্যাটাস অনলাইন থাকলে একবারে অফলাইন না করে একটি সুযোগ দিতে পারেন, 
      // অথবা সরাসরি অফলাইন করতে পারেন। এখানে স্বাভাবিক নিয়ম রাখা হলো:
      ch.status = "Offline";
    }
    console.log(`Verified ${ch.name} -> ${ch.status}`);
  }

  // সুরক্ষা: যদি এমন হয় যে ইন্টারনেট চলে যাওয়ার কারণে সব চ্যানেল অফলাইন হয়ে গেছে (onlineCount === 0),
  // তবে ফাইল ওভাররাইট বা খালি করা থেকে বটকে রক্ষা করার জন্য এটি ব্যবহার করতে পারেন:
  if (onlineCount === 0 && channels.length > 0) {
    console.log("[Warning] All channels detected as offline. Possible internet disconnection. Skipping file updates to protect data.");
    return;
  }

  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

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
