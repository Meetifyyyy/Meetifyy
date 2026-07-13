import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(__dirname, '../public/fonts');

if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const googleFontsUrls = [
  'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
  'https://fonts.googleapis.com/css2?family=Changa+One:ital@0;1&display=swap',
  'https://fonts.googleapis.com/css2?family=Changa:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block'
];

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
  console.log(`Downloaded ${url} to ${dest}`);
}

async function main() {
  let combinedCss = '';
  
  for (const url of googleFontsUrls) {
    console.log(`Fetching CSS from: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    if (!res.ok) throw new Error(`Failed to fetch CSS from ${url}`);
    let cssText = await res.text();
    combinedCss += cssText + '\n';
  }

  // Regex to parse font-face blocks
  const fontFaceRegex = /@font-face\s*\{[^}]*\}/g;
  const fontFaces = combinedCss.match(fontFaceRegex) || [];
  
  let localCss = '';
  const downloadedUrls = new Map();
  
  for (let i = 0; i < fontFaces.length; i++) {
    const block = fontFaces[i];
    
    // Extract font-family, font-weight, font-style, and src url
    const familyMatch = block.match(/font-family:\s*['"]?([^'"]+)['"]?;/);
    const weightMatch = block.match(/font-weight:\s*([^;]+);/);
    const styleMatch = block.match(/font-style:\s*([^;]+);/);
    const urlMatch = block.match(/url\((https:\/\/[^)]+)\)/);
    
    if (familyMatch && urlMatch) {
      const family = familyMatch[1];
      const weight = weightMatch ? weightMatch[1].trim() : 'normal';
      const style = styleMatch ? styleMatch[1].trim() : 'normal';
      const remoteUrl = urlMatch[1];
      
      const cleanFamily = family.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const cleanWeight = weight.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase();
      const cleanStyle = style.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      
      let filename;
      try {
        if (downloadedUrls.has(remoteUrl)) {
          filename = downloadedUrls.get(remoteUrl);
        } else {
          filename = `${cleanFamily}-${cleanWeight}-${cleanStyle}-${i}.woff2`;
          const destPath = path.join(fontsDir, filename);
          await downloadFile(remoteUrl, destPath);
          downloadedUrls.set(remoteUrl, filename);
        }
        
        // Reconstruct local @font-face
        let localBlock = block.replace(remoteUrl, `/fonts/${filename}`);
        
        // Ensure display: swap or display: block is set based on font family
        const targetDisplay = cleanFamily.includes('material') ? 'block' : 'swap';
        if (localBlock.includes('font-display:')) {
          localBlock = localBlock.replace(/font-display:\s*[^;]+;/, `font-display: ${targetDisplay};`);
        } else {
          localBlock = localBlock.replace('{', `{\n  font-display: ${targetDisplay};`);
        }
        
        localCss += localBlock + '\n';
      } catch (err) {
        console.error(`Failed to download font: ${remoteUrl}`, err);
      }
    }
  }
  
  fs.writeFileSync(path.join(__dirname, '../src/styles/fonts.css'), localCss);
  console.log('Font downloading and CSS generation complete!');
}

main().catch(console.error);
