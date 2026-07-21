const fs = require('fs');
const axios = require('axios');

async function checkUrl(url) {
  const cleanUrl = url.split('|')[0].trim();
  
  try {
    const response = await axios({
      method: 'get',
      url: cleanUrl,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Range': 'bytes=0-1024'
      },
      validateStatus: (status) => status >= 200 && status < 400
    });
    return true;
  } catch (error) {
    if (error.response && (error.response.status === 403 || error.response.status === 405)) {
      console.log(`[Warning] Access restricted for ${cleanUrl} (HTTP ${error.response.status}). Keeping previous state.`);
      return true;
    }
    return false;
  }
}

async function runBot() {
  console.log("Starting NowshinTV background channel validation...");
  
  if (!fs.existsSync('./channels.json')) {
    console.error("channels.json file not found!");
    return;
  }

  const rawData = fs.readFileSync('./channels.json', 'utf8');
  let channels = JSON.parse(rawData);

  for (let ch of channels) {
    const isLive = await checkUrl(ch.url);
    ch.status = isLive ? "Online" : "Offline";
    console.log(`Verified ${ch.name} -> ${ch.status}`);
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
