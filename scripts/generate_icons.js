// Gera os ícones PNG do PWA a partir de public/icon.svg (e a variante
// maskable a partir de public/icon-maskable.svg, com a gota reduzida pra
// caber na "safe zone" central de 80% exigida por ícones maskable — sem
// isso, launchers Android que aplicam máscara circular/squircle cortam as
// pontas da gota).
// Uso: node scripts/generate_icons.js
const sharp = require("sharp");
const path = require("path");

const svgPath = path.join(__dirname, "..", "public", "icon.svg");
const maskableSvgPath = path.join(__dirname, "..", "public", "icon-maskable.svg");
const sizes = [192, 512];

async function main() {
  for (const size of sizes) {
    const outPath = path.join(__dirname, "..", "public", `icon-${size}.png`);
    await sharp(svgPath, { density: 384 }).resize(size, size).png().toFile(outPath);
    console.log(`Gerado icon-${size}.png`);
  }

  const maskableOut = path.join(__dirname, "..", "public", "icon-maskable-512.png");
  await sharp(maskableSvgPath, { density: 384 }).resize(512, 512).png().toFile(maskableOut);
  console.log("Gerado icon-maskable-512.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
