const fs = require('fs');
const https = require('https');

const FILE_NAME = 'playlist.m3u';

function parseM3U(data) {
    const lines = data.split('\n');
    const channels = [];
    let current = null;

    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            current = {};
            const nameMatch = line.match(/,(.+)$/);
            current.name = nameMatch ? nameMatch[1].trim() : "Unknown";
            
            const logoMatch = line.match(/tvg-logo="([^"]+)"/);
            current.logo = logoMatch ? logoMatch[1] : "";

            const groupMatch = line.match(/group-title="([^"]+)"/);
            current.category = groupMatch ? groupMatch[1] : "General";

            const serialMatch = line.match(/tvg-id="([^"]+)"/);
            current.serial = serialMatch ? serialMatch[1] : "0";
        } else if (line && !line.startsWith('#')) {
            if (current) {
                current.url = line;
                channels.push(current);
                current = null;
            }
        }
    });
    return channels;
}

function checkUrl(url) {
    return new Promise((resolve) => {
        // Advanced link structural tokenization stripping parameters
        const cleanUrl = url.split('|')[0].trim();
        if(!cleanUrl.startsWith('http')) return resolve(false);

        const req = https.request(cleanUrl, { method: 'HEAD', timeout: 8000 }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

async function startBot() {
    if (!fs.existsSync(FILE_NAME)) return;
    const rawData = fs.readFileSync(FILE_NAME, 'utf8');
    const channels = parseM3U(rawData);
    
    console.log(`Starting execution over ${channels.length} channels...`);

    for (let ch of channels) {
        console.log(`Checking live integrity for: ${ch.name}`);
        const isAlive = await checkUrl(ch.url);
        // Requirement 2 & 3: Dead link turns off instantly, live link registers instantly
        ch.status = isAlive ? "Online" : "Offline";
    }

    let m3uOutput = "#EXTM3U\n";
    channels.forEach(ch => {
        m3uOutput += `#EXTINF:-1 tvg-id="${ch.serial}" tvg-logo="${ch.logo}" group-title="${ch.category}" status="${ch.status}",${ch.name}\n${ch.url}\n`;
    });

    fs.writeFileSync(FILE_NAME, m3uOutput, 'utf8');
    console.log("Database compilation sync completed successfully.");
}

startBot();
