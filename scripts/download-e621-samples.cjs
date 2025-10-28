const fs = require('fs');
const https = require('https');
const path = require('path');

const inputFile = process.argv[2] || 'D:/pawtropolis-tech/assets/e621-safe-sample.json';
const prefix = process.argv[3] || 'safe';
const outputDir = process.argv[4] || 'D:/pawtropolis-tech/assets/testing-safe';

const data = JSON.parse(fs.readFileSync(inputFile));

// Filter for image files only (no webm videos)
const images = data.posts
  .filter(p => ['png', 'jpg', 'jpeg'].includes(p.file.ext))
  .slice(0, 5)
  .map((p, i) => ({
    id: p.id,
    url: p.file.url,
    filename: `e621_${prefix}_${i+1}_${p.id}.${p.file.ext}`,
    rating: p.rating
  }));

console.log(`Downloading ${images.length} ${prefix} E621 images...\n`);

const downloadDir = outputDir;
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, {
      headers: {
        'User-Agent': 'PawtropolisTech/1.0 (Testing NSFW detector)'
      }
    }, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  for (const img of images) {
    const destPath = path.join(downloadDir, img.filename);
    console.log(`Downloading ${img.filename} (ID: ${img.id})...`);
    try {
      await download(img.url, destPath);
      console.log(`✓ Saved to ${destPath}\n`);
    } catch (err) {
      console.error(`✗ Failed: ${err.message}\n`);
    }
  }
  console.log('Done!');
}

main();
