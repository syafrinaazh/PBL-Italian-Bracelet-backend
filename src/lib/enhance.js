const sharp = require("sharp");

const SIZE = 800;   // ukuran output persegi
const FILL = 0.88;  // charm mengisi 88% kanvas (turunkan kalau terlalu mepet)

// bounding box dari piksel yang tidak transparan
function alphaBBox(data, w, h, ch, thr = 10) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + (ch - 1)] > thr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// cari sudut miring: putar titik mask, pilih sudut dengan kotak terkecil
async function findTilt(alphaPng) {
  const { data, info } = await sharp(alphaPng)
    .resize(160, 160, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pts = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > 128) pts.push([x, y]);
    }
  }
  if (!pts.length) return 0;

  let best = 0;
  let bestArea = Infinity;
  for (let a = -45; a <= 45; a += 0.5) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      const rx = x * c - y * s;
      const ry = x * s + y * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) {
      bestArea = area;
      best = a;
    }
  }
  return best;
}

async function enhanceCharm(inputBuffer) {
  // paket ini hanya bisa di-import dinamis dari CommonJS
  const { removeBackground } = await import("@imgly/background-removal-node");

  // 0. normalisasi: PNG, maksimal 1600px, ikuti rotasi EXIF
  const png = await sharp(inputBuffer)
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  // 1. hapus background
  const blob = await removeBackground(new Blob([png], { type: "image/png" }));
  const cut = Buffer.from(await blob.arrayBuffer());

  // 2. bersihkan mask (buang bayangan, haluskan tepi)
  const alpha = await sharp(cut)
    .extractChannel(3)
    .threshold(220)
    .median(5)
    .blur(0.8)
    .png()
    .toBuffer();
  const rgb = await sharp(cut).removeAlpha().toBuffer();
  const cleaned = await sharp(rgb).joinChannel(alpha).png().toBuffer();

  // 3. luruskan
  const tilt = await findTilt(alpha);
  const rotated = await sharp(cleaned)
    .rotate(tilt, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 4. trim ke tepi charm
  const { data, info } = await sharp(rotated)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const box = alphaBBox(data, info.width, info.height, info.channels);
  const trimmed = box ? await sharp(rotated).extract(box).toBuffer() : rotated;

  // 5. sesuaikan ukuran + tajamkan
  const target = Math.round(SIZE * FILL);
  const charm = await sharp(trimmed)
    .resize(target, target, { fit: "inside", kernel: "lanczos3" })
    .sharpen({ sigma: 1.2 })
    .linear(1.08, -10)
    .png()
    .toBuffer();

  // 6. taruh di tengah kanvas transparan
  return sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: charm, gravity: "centre" }])
    .png()
    .toBuffer();
}

module.exports = { enhanceCharm };