// Gera os ícones PNG do PWA a partir de public/icon.svg.
// Uso: node scripts/generate_icons.js
const sharp = require("sharp");
const path = require("path");

const svgPath = path.join(__dirname, "..", "public", "icon.svg");
const sizes = [192, 512];

async function main() {
  for (const size of sizes) {
    const outPath = path.join(__dirname, "..", "public", `icon-${size}.png`);
    await sharp(svgPath, { density: 384 }).resize(size, size).png().toFile(outPath);
    console.log(`Gerado icon-${size}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
