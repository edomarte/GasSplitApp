/**
 * Renders the app icons from one SVG, so they can be regenerated rather than
 * hand-maintained at five sizes.
 *
 *   node scripts/generate-icons.mjs
 *
 * The mark is a fuel drop divided down the middle: what the app does, legible
 * at 32 pixels where anything more detailed turns to mud.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const BACKGROUND = "#0a0a0a";
const FOREGROUND = "#ffffff";

/** @param {number} inset padding as a fraction, for maskable icons */
function icon(inset = 0) {
  const scale = 1 - inset * 2;
  const shift = 512 * inset;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${inset > 0 ? 0 : 112}" fill="${BACKGROUND}"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">
    <path d="M256 84 C 256 84, 140 232, 140 316 a 116 116 0 0 0 232 0 C 372 232, 256 84, 256 84 Z"
          fill="${FOREGROUND}"/>
    <!-- Darkens the left half rather than lightening it: white at any opacity
         over white is still white, which is what the first attempt produced. -->
    <path d="M256 84 C 256 84, 140 232, 140 316 a 116 116 0 0 0 116 116 Z"
          fill="${BACKGROUND}" opacity="0.42"/>
    <rect x="248" y="84" width="16" height="348" fill="${BACKGROUND}"/>
  </g>
</svg>`.trim();
}

const OUTPUTS = [
  { file: "public/icon-192.png", size: 192, svg: icon() },
  { file: "public/icon-512.png", size: 512, svg: icon() },
  // Maskable icons are cropped to a circle on Android, so the mark needs room.
  { file: "public/icon-maskable-512.png", size: 512, svg: icon(0.14) },
  { file: "src/app/apple-icon.png", size: 180, svg: icon() },
  { file: "src/app/icon.png", size: 512, svg: icon() },
];

await mkdir("public", { recursive: true });

for (const { file, size, svg } of OUTPUTS) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(join(process.cwd(), file), png);
  console.log(`  ${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

console.log("\nIcons written. Re-run after changing the mark.");
