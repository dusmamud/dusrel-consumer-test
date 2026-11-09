// Pack-smoke test for the PUBLISHED @dusrel/* 1.0.0 packages, run in Node
// against this project's node_modules (installed from the npm registry).
// Browser-only globals the libraries legitimately target are stubbed the
// same way the monorepo's own unit tests stub them.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// The codec loaders fetch their .wasm from a URL relative to the module —
// in a browser that is an http(s) URL; in this Node harness it is a file:
// URL, which undici refuses. Serve file: URLs from disk so the published
// loaders run exactly as shipped.
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url;
  if (typeof url === "string" && url.startsWith("file://")) {
    const bytes = await readFile(fileURLToPath(url));
    return new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
  }
  return nodeFetch(input, init);
};
globalThis.ImageData = class ImageData {
  constructor(dataOrWidth, widthOrHeight, maybeHeight) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = maybeHeight ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
};

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function px(data, w, x, y) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
function makePixels(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  return { data, width: w, height: h };
}
const gradient = makePixels(32, 32, (x, y) => [
  Math.round((x / 31) * 255),
  Math.round((y / 31) * 255),
  128,
  255,
]);

console.log("== export surface (every installed package) ==");
const surface = {
  "@dusrel/image": ["processImage", "pipeline", "processBatch", "codecPlugin", "imageDataPlugin"],
  "@dusrel/image-core": ["processImage", "DusrelImageError", "normalizeRotation", "rotatedDimensions"],
  "@dusrel/image-react": ["useProcessImage", "useProcessBatch", "DusrelCrop", "createProcessor"],
  "@dusrel/image-crop": ["clampCrop", "initialCrop", "moveCrop", "resizeCrop"],
  "@dusrel/image-jpeg": ["encode", "decode", "setCodecAssets"],
  "@dusrel/image-webp": ["encode", "decode", "setCodecAssets"],
  "@dusrel/image-avif": ["encode", "decode", "setCodecAssets"],
  "@dusrel/image-png": ["encode", "decode", "setCodecAssets"],
  "@dusrel/image-oxipng": ["optimize", "setCodecAssets"],
  "@dusrel/image-quantize": ["quantize", "quantizeToImageData"],
  "@dusrel/image-resize": ["resize"],
  "@dusrel/image-jxl": ["encode", "decode", "setCodecAssets"],
  "@dusrel/image-qoi": ["encode", "decode", "setCodecAssets"],
  "@dusrel/image-heic": ["decodeHeic", "decodeHeicWasm", "isHeic"],
  "@dusrel/image-transform": ["flipHorizontal", "flipVertical", "rotateQuarter", "warpPerspective"],
  "@dusrel/image-adjust": ["adjust", "grayscale", "sharpen", "gaussianBlur"],
  "@dusrel/image-metadata": ["readMetadata", "stripMetadata", "detectFormat", "hasGps"],
  "@dusrel/image-watermark": ["applyWatermark", "placementsFor", "resolveWatermarkOptions"],
  "@dusrel/image-batch": ["runBatch", "BatchQueue", "createWorkerPool"],
  "@dusrel/image-gif": ["encode", "decode", "optimize"],
  "@dusrel/image-svg": ["optimizeSvg", "optimizeSvgWithStats"],
  "@dusrel/image-placeholder": ["encodeThumbHash", "decodeThumbHash", "encodeBlurHash", "decodeBlurHash", "averageColor"],
};
for (const [pkg, names] of Object.entries(surface)) {
  await check(`${pkg} exports`, async () => {
    const mod = await import(pkg);
    for (const n of names) assert(typeof mod[n] === "function" || typeof mod[n] === "object", `missing export ${n}`);
  });
}

console.log("== codecs: real encode/decode roundtrips ==");
await check("jpeg encode magic + decode", async () => {
  const { encode, decode } = await import("@dusrel/image-jpeg");
  const out = new Uint8Array(await encode(gradient, { quality: 90 }));
  assert(out[0] === 0xff && out[1] === 0xd8, "missing JPEG SOI");
  const back = await decode(out);
  assert(back.width === 32 && back.height === 32, "dims");
  const [r, g, b] = px(back.data, 32, 31, 0);
  assert(Math.abs(r - 255) <= 12 && g <= 12 && Math.abs(b - 128) <= 12, `pixel drift ${r},${g},${b}`);
});
await check("webp lossless exact roundtrip", async () => {
  const { encode, decode } = await import("@dusrel/image-webp");
  const out = new Uint8Array(await encode(gradient, { lossless: true }));
  assert(new TextDecoder().decode(out.slice(0, 4)) === "RIFF", "no RIFF");
  assert(new TextDecoder().decode(out.slice(8, 12)) === "WEBP", "no WEBP");
  const back = await decode(out);
  assert(Buffer.from(back.data).equals(Buffer.from(gradient.data)), "pixels differ");
});
await check("png exact roundtrip + oxipng shrinks", async () => {
  const png = await import("@dusrel/image-png");
  const out = new Uint8Array(await png.encode(gradient));
  assert(out[0] === 0x89 && out[1] === 0x50, "no PNG magic");
  const back = await png.decode(out);
  assert(Buffer.from(back.data).equals(Buffer.from(gradient.data)), "pixels differ");
  const { optimize } = await import("@dusrel/image-oxipng");
  const opt = new Uint8Array(await optimize(out));
  assert(opt.length <= out.length, `oxipng grew file ${out.length} -> ${opt.length}`);
  const back2 = await png.decode(opt);
  assert(Buffer.from(back2.data).equals(Buffer.from(gradient.data)), "optimised pixels differ");
});
await check("qoi magic + exact roundtrip", async () => {
  const { encode, decode } = await import("@dusrel/image-qoi");
  const out = new Uint8Array(await encode(gradient));
  assert(new TextDecoder().decode(out.slice(0, 4)) === "qoif", "no qoif magic");
  const back = await decode(out);
  assert(Buffer.from(back.data).equals(Buffer.from(gradient.data)), "pixels differ");
});
await check("resize 32x32 -> 8x8", async () => {
  const { resize } = await import("@dusrel/image-resize");
  const out = await resize(gradient, { width: 8, height: 8 });
  assert(out.width === 8 && out.height === 8, "dims");
});
await check("quantize <= 16 colors", async () => {
  const { quantize } = await import("@dusrel/image-quantize");
  const res = await quantize(gradient, { maxColors: 16 });
  assert(res.colorCount <= 16, `colorCount ${res.colorCount}`);
  assert(res.indices.length === 32 * 32, "indices length");
});
await check("avif encode ftyp + decode dims", async () => {
  const { encode, decode } = await import("@dusrel/image-avif");
  const out = new Uint8Array(await encode(gradient, { quality: 60 }));
  assert(new TextDecoder().decode(out.slice(4, 8)) === "ftyp", "no ftyp");
  assert(new TextDecoder().decode(out.slice(8, 12)) === "avif", "brand not avif");
  const back = await decode(out);
  assert(back.width === 32 && back.height === 32, "dims");
});
await check("jxl lossless exact roundtrip", async () => {
  const { encode, decode } = await import("@dusrel/image-jxl");
  const out = new Uint8Array(await encode(gradient, { lossless: true }));
  assert(out[0] === 0xff && out[1] === 0x0a, "no JXL signature");
  const back = await decode(out);
  assert(Buffer.from(back.data).equals(Buffer.from(gradient.data)), "pixels differ");
});
await check("gif 2-frame roundtrip + optimize", async () => {
  const { encode, decode, optimize } = await import("@dusrel/image-gif");
  const red = makePixels(16, 16, () => [255, 0, 0, 255]);
  const green = makePixels(16, 16, () => [0, 255, 0, 255]);
  const out = await encode(
    [
      { data: red, delay: 100 },
      { data: green, delay: 200 },
    ],
    { repeat: 0 },
  );
  assert(new TextDecoder().decode(out.slice(0, 6)) === "GIF89a", "no GIF89a");
  const dec = await decode(out);
  assert(dec.frames.length === 2, `frames ${dec.frames.length}`);
  assert(dec.frames[0].delay === 100 && dec.frames[1].delay === 200, "delays");
  assert(px(dec.frames[0].data.data, 16, 0, 0)[0] === 255, "frame0 not red");
  assert(px(dec.frames[1].data.data, 16, 0, 0)[1] === 255, "frame1 not green");
  const opt = await optimize(out);
  assert(opt.length <= out.length, "optimize grew file");
});
await check("heic sniffing + typed rejection", async () => {
  const { isHeic, decodeHeic } = await import("@dusrel/image-heic");
  const ftyp = new Uint8Array(24);
  ftyp.set([0, 0, 0, 24], 0);
  ftyp.set(new TextEncoder().encode("ftypheic"), 4);
  assert(isHeic(ftyp) === true, "heic brand not detected");
  assert(isHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === false, "jpeg misdetected");
  let threw = null;
  try {
    await decodeHeic(new Uint8Array([1, 2, 3, 4]));
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof RangeError, `expected RangeError, got ${threw}`);
});

console.log("== pure feature packages ==");
await check("placeholder roundtrips + invariants", async () => {
  const p = await import("@dusrel/image-placeholder");
  const img = makePixels(8, 4, (x, y) => [x * 36, y * 85, 200, 255]);
  const th = p.encodeThumbHash(img);
  assert(Math.abs(p.thumbHashAspectRatio(th) - 2) < 0.3, "aspect");
  const thBack = p.decodeThumbHash(th);
  assert(thBack.width > thBack.height, "thumbhash decode orientation");
  const b64 = p.thumbHashToBase64(th);
  assert(p.thumbHashFromBase64(b64).length === th.length, "base64 roundtrip");
  const bh = p.encodeBlurHash(img);
  assert(p.isValidBlurHash(bh), "invalid blurhash");
  const comps = p.blurHashComponents(bh);
  assert(comps.componentX === 4 && comps.componentY === 3, "components");
  const bhBack = p.decodeBlurHash(bh, 8, 4);
  assert(bhBack.width === 8 && bhBack.height === 4, "blurhash decode dims");
  const avg = p.averageColor(img);
  assert(avg.r > 100 && avg.r < 160 && avg.b === 200, "averageColor");
});
await check("metadata hand-built EXIF GPS + strip", async () => {
  const { readMetadata, stripMetadata, detectFormat, hasGps } = await import("@dusrel/image-metadata");
  // Minimal JPEG: SOI + APP1(Exif TIFF, GPS 28.6 / -77.2) + EOI
  const tiff = new Uint8Array(128);
  const dv = new DataView(tiff.buffer);
  tiff.set(new TextEncoder().encode("II"), 0);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true); // IFD0: 1 entry
  dv.setUint16(10, 0x8825, true); // GPS IFD pointer
  dv.setUint16(12, 4, true);
  dv.setUint32(14, 1, true);
  dv.setUint32(18, 26, true); // GPS IFD at 26
  dv.setUint32(22, 0, true);
  dv.setUint16(26, 4, true); // GPS IFD: 4 entries
  const entry = (off, tag, type, count, value) => {
    dv.setUint16(off, tag, true);
    dv.setUint16(off + 2, type, true);
    dv.setUint32(off + 4, count, true);
    dv.setUint32(off + 8, value, true);
  };
  entry(28, 1, 2, 2, 0x4e); // LatRef "N"
  entry(40, 2, 5, 3, 80); // Lat rationals at 80
  entry(52, 3, 2, 2, 0x57); // LonRef "W"
  entry(64, 4, 5, 3, 104); // Lon rationals at 104
  dv.setUint32(76, 0, true);
  const rat = (off, n, d) => {
    dv.setUint32(off, n, true);
    dv.setUint32(off + 4, d, true);
  };
  rat(80, 28, 1); rat(88, 36, 1); rat(96, 0, 1);
  rat(104, 77, 1); rat(112, 12, 1); rat(120, 0, 1);
  const app1Len = 2 + 6 + tiff.length;
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new TextEncoder().encode("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  const jpg = new Uint8Array(2 + app0.length + 2 + app1Len + sos.length + 3 + 2);
  let o = 0;
  jpg.set([0xff, 0xd8], o); o += 2;
  jpg.set(app0, o); o += app0.length;
  jpg.set([0xff, 0xe1, app1Len >> 8, app1Len & 0xff], o); o += 4;
  jpg.set(new TextEncoder().encode("Exif\0\0"), o); o += 6;
  jpg.set(tiff, o); o += tiff.length;
  jpg.set(sos, o); o += sos.length;
  jpg.set([0x00, 0x11, 0x22], o); o += 3;
  jpg.set([0xff, 0xd9], o);
  assert(detectFormat(jpg) === "jpeg", "format");
  const info = readMetadata(jpg);
  assert(info.exifPresent === true, "exif not detected");
  assert(Math.abs(info.exif.gps.latitude - 28.6) < 1e-9, `lat ${info.exif?.gps?.latitude}`);
  assert(Math.abs(info.exif.gps.longitude + 77.2) < 1e-9, `lon ${info.exif?.gps?.longitude}`);
  assert(hasGps(jpg) === true, "hasGps");
  const stripped = stripMetadata(jpg);
  const info2 = readMetadata(stripped);
  assert(info2.exifPresent === false, "strip failed");
  assert(info2.format === "jpeg", "stripped format");
});
await check("transform flip + rotateQuarter", async () => {
  const { flipHorizontal, rotateQuarter } = await import("@dusrel/image-transform");
  const img = makePixels(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
  const flipped = flipHorizontal(img);
  assert(px(flipped.data, 2, 0, 0)[1] === 255 && px(flipped.data, 2, 1, 0)[0] === 255, "flip order");
  const rot = rotateQuarter(img, 1);
  assert(rot.width === 1 && rot.height === 2, "rotated dims");
});
await check("adjust grayscale red = 54", async () => {
  const { grayscale } = await import("@dusrel/image-adjust");
  const red = makePixels(1, 1, () => [255, 0, 0, 255]);
  const out = grayscale(red);
  assert(out.data[0] === 54, `got ${out.data[0]}`);
});
await check("watermark placements + apply", async () => {
  const { applyWatermark, placementsFor, resolveWatermarkOptions } = await import("@dusrel/image-watermark");
  const base = makePixels(100, 100, () => [0, 0, 0, 255]);
  const mark = makePixels(10, 10, () => [255, 255, 255, 255]);
  const out = applyWatermark(base, mark, { position: "bottom-right", opacity: 1 });
  // defaults: mark width = 20% of image width (20px), margin 16 ->
  // the mark occupies [64,84) x [64,84); its centre is (74,74).
  assert(px(out.data, 100, 74, 74)[0] === 255, "mark centre not marked");
  assert(px(out.data, 100, 99, 99)[0] === 0, "corner wrongly marked (margin ignored)");
  assert(px(out.data, 100, 0, 0)[0] === 0, "origin wrongly marked");
  const tiles = placementsFor(100, 100, 1, resolveWatermarkOptions({ position: "tile" }));
  assert(tiles.length > 1, "tile placements");
});
await check("batch runBatch order + values", async () => {
  const { runBatch } = await import("@dusrel/image-batch");
  const results = await runBatch([1, 2, 3], async (n) => n * 2, { concurrency: 2 });
  assert(results.every((r) => r.status === "fulfilled"), "not all fulfilled");
  assert(results.map((r) => r.result ?? r.value).join(",") === "2,4,6", `values ${JSON.stringify(results)}`);
});
await check("crop geometry pinned values", async () => {
  const { initialCrop } = await import("@dusrel/image-crop");
  const c = initialCrop({ width: 1000, height: 500 });
  assert(c.x === 100 && c.y === 50 && c.width === 800 && c.height === 400, JSON.stringify(c));
});
await check("svg optimize shrinks + strips comments", async () => {
  const { optimizeSvgWithStats } = await import("@dusrel/image-svg");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- a comment --><rect x="0" y="0" width="10" height="10" fill="#ff0000"/></svg>`;
  const res = optimizeSvgWithStats(svg);
  assert(!res.svg.includes("<!--"), "comment survived");
  assert(res.outputBytes < res.originalBytes, "did not shrink");
});
await check("core pure geometry", async () => {
  const { normalizeRotation, rotatedDimensions } = await import("@dusrel/image-core");
  assert(normalizeRotation(450) === 90, "normalizeRotation");
  const d = rotatedDimensions(100, 50, 90);
  assert(d.width === 50 && d.height === 100, "rotatedDimensions");
});
await check("image pipeline builder + codecPlugin shape", async () => {
  const { pipeline, codecPlugin, downgradeChain } = await import("@dusrel/image");
  const b = pipeline().resize({ width: 10 });
  assert(typeof b.run === "function" && typeof b.plan === "function", "builder shape");
  const plugin = codecPlugin({ mimeType: "image/x-fake", encode: async () => new Uint8Array([1]) });
  assert(typeof plugin.run === "function" || typeof plugin.transform === "function" || typeof plugin === "object", "plugin shape");
  const chain = downgradeChain("image/webp");
  assert(Array.isArray(chain) && chain.length >= 1, "downgradeChain");
});
await check("react processor store runs headless", async () => {
  const { createProcessor } = await import("@dusrel/image-react");
  const fake = { blob: new Blob(["x"], { type: "image/png" }), format: "image/png" };
  const store = createProcessor(async () => fake);
  assert(store.getState().status === "idle", "initial state");
  const out = await store.process(new Blob(["in"]));
  assert(out === fake, "process result");
  assert(store.getState().status === "success", `status ${store.getState().status}`);
});

console.log(`\nSMOKE RESULT: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
