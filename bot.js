const fs = require('fs');
const axios = require('axios');

async function checkUrl(url) {
  const cleanUrl = url.split('|')[0];
  try {
    const response = await axios.get(cleanUrl, {
      timeout: 7000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    return response.status >= 200 && response.status < 400;
  } catch (error) {
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

  // Sort channels by serial
  channels.sort((a, b) => Number(a.serial) - Number(b.serial));

  // Write back to channels.json
  fs.writeFileSync('./channels.json', JSON.stringify(channels, null, 2), 'utf8');

  // Build playlist.m3u containing only Online active streams
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
