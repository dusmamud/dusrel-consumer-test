import { useEffect, useRef, useState } from "react";
import { DusrelCrop, useProcessImage } from "@dusrel/image-react";
import {
  encode as encodeJpeg,
  decode as decodeJpeg,
  setCodecAssets as setJpegAssets,
} from "@dusrel/image-jpeg";
import { encode as encodeWebp, decode as decodeWebp } from "@dusrel/image-webp";
import { encode as encodePng, decode as decodePng } from "@dusrel/image-png";
import { encode as encodeAvif } from "@dusrel/image-avif";
import { encode as encodeJxl, decode as decodeJxl } from "@dusrel/image-jxl";
import { encode as encodeQoi, decode as decodeQoi } from "@dusrel/image-qoi";
import { encode as encodeGif, decode as decodeGif, optimize as optimizeGif } from "@dusrel/image-gif";
import { decodeHeic, isHeic } from "@dusrel/image-heic";
import { optimize as optimizePng } from "@dusrel/image-oxipng";
import { quantize } from "@dusrel/image-quantize";
import { resize } from "@dusrel/image-resize";
import { flipHorizontal, rotateQuarter } from "@dusrel/image-transform";
import { grayscale } from "@dusrel/image-adjust";
import { hasGps, readMetadata, stripMetadata } from "@dusrel/image-metadata";
import { applyWatermark } from "@dusrel/image-watermark";
import { optimizeSvg } from "@dusrel/image-svg";
import { runBatch } from "@dusrel/image-batch";
import { initialCrop } from "@dusrel/image-crop";
import { processImage as coreProcessImage } from "@dusrel/image-core";
import { processImage, toImageData } from "@dusrel/image";
import {
  decodeBlurHash,
  decodeThumbHash,
  encodeBlurHash,
  encodeThumbHash,
  thumbHashToBase64,
} from "@dusrel/image-placeholder";
import type { CropRect } from "@dusrel/image-crop";
// The documented escape hatch for bundlers: hand the codec loader
// bundler-emitted asset URLs instead of its import.meta.url defaults.
import jpegEncJs from "@dusrel/image-jpeg/codec/mozjpeg_enc.js?url";
import jpegEncWasm from "@dusrel/image-jpeg/codec/mozjpeg_enc.wasm?url";
import jpegDecJs from "@dusrel/image-jpeg/codec/mozjpeg_dec.js?url";
import jpegDecWasm from "@dusrel/image-jpeg/codec/mozjpeg_dec.wasm?url";

type LabLine = { id: string; ok: boolean | null; text: string };
type Group = "codecs" | "tools" | "flow";

const CHECKS: { id: string; name: string; hint: string; group: Group }[] = [
  { id: "jpeg-encode", name: "JPEG encode", hint: "MozJPEG, default asset URLs", group: "codecs" },
  { id: "jpeg-url", name: "JPEG encode, ?url assets", hint: "setCodecAssets escape hatch", group: "codecs" },
  { id: "jpeg-roundtrip", name: "JPEG roundtrip", hint: "MozJPEG encode → decode", group: "codecs" },
  { id: "webp-encode", name: "WebP encode", hint: "libwebp, default asset URLs", group: "codecs" },
  { id: "webp-roundtrip", name: "WebP lossless roundtrip", hint: "pixel-exact", group: "codecs" },
  { id: "png-encode", name: "PNG encode", hint: "Rust png crate, default asset URLs", group: "codecs" },
  { id: "png-roundtrip", name: "PNG roundtrip", hint: "pixel-exact", group: "codecs" },
  { id: "avif-encode", name: "AVIF encode", hint: "libaom + libavif, quality 50, speed 9", group: "codecs" },
  { id: "jxl-roundtrip", name: "JPEG XL roundtrip", hint: "libjxl, lossless", group: "codecs" },
  { id: "qoi-roundtrip", name: "QOI roundtrip", hint: "pixel-exact", group: "codecs" },
  { id: "gif-encode", name: "GIF encode + optimise", hint: "Rust gif crate, 2 frames", group: "codecs" },
  { id: "heic-decode", name: "HEIC decode", hint: "native-first, libheif WASM fallback", group: "codecs" },
  { id: "oxipng", name: "OxiPNG optimise", hint: "lossless PNG recompression", group: "tools" },
  { id: "quantize", name: "Quantize", hint: "palette reduction to 32 colours", group: "tools" },
  { id: "resize", name: "Resize", hint: "Lanczos3 to 160×90", group: "tools" },
  { id: "transform", name: "Transform", hint: "flip + rotate 90°", group: "tools" },
  { id: "adjust", name: "Adjust", hint: "grayscale LUT pass", group: "tools" },
  { id: "metadata", name: "Metadata", hint: "EXIF GPS parse + strip", group: "tools" },
  { id: "watermark", name: "Watermark", hint: "pixel composite, bottom-right", group: "tools" },
  { id: "svg", name: "SVG optimise", hint: "SVGO multipass", group: "tools" },
  { id: "core-process", name: "Core processImage", hint: "canvas engine, resize + WebP", group: "flow" },
  { id: "pipeline-avif", name: "Flagship + AVIF codec", hint: "processImage with a registered codec", group: "flow" },
  { id: "batch", name: "Batch pool", hint: "runBatch, order preserved", group: "flow" },
  { id: "crop-geometry", name: "Crop geometry", hint: "initialCrop pinned values", group: "flow" },
  { id: "placeholder", name: "Placeholders", hint: "ThumbHash and BlurHash roundtrip", group: "flow" },
];

const fmtBytes = (n: number) => `${n.toLocaleString("en-US")} bytes`;
const bytes = (x: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> =>
  x instanceof Uint8Array ? (x as Uint8Array<ArrayBuffer>) : new Uint8Array(x);
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.slice(from, to));

function samePixels(
  a: { data: Uint8ClampedArray; width: number; height: number },
  b: { data: Uint8ClampedArray; width: number; height: number },
) {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Hand-built JPEG carrying an EXIF GPS fix (28.6, −77.2) — same fixture as the Node pack-smoke. */
function buildExifGpsJpeg(): Uint8Array {
  const tiff = new Uint8Array(128);
  const dv = new DataView(tiff.buffer);
  tiff.set(new TextEncoder().encode("II"), 0);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x8825, true);
  dv.setUint16(12, 4, true);
  dv.setUint32(14, 1, true);
  dv.setUint32(18, 26, true);
  dv.setUint32(22, 0, true);
  dv.setUint16(26, 4, true);
  const entry = (off: number, tag: number, type: number, count: number, value: number) => {
    dv.setUint16(off, tag, true);
    dv.setUint16(off + 2, type, true);
    dv.setUint32(off + 4, count, true);
    dv.setUint32(off + 8, value, true);
  };
  entry(28, 1, 2, 2, 0x4e);
  entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 0x57);
  entry(64, 4, 5, 3, 104);
  dv.setUint32(76, 0, true);
  const rat = (off: number, n: number, d: number) => {
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
  return jpg;
}

function drawGradient(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "#e2552f");
  grad.addColorStop(0.5, "#2f9ee2");
  grad.addColorStop(1, "#37d67a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("@dusrel consumer test", 12, 30);
}

export default function App() {
  const labCanvasRef = useRef<HTMLCanvasElement>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);
  const [lines, setLines] = useState<LabLine[]>([]);
  const [demoUrl, setDemoUrl] = useState<string>("");
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [hashes, setHashes] = useState<{ thumb: string; blur: string } | null>(null);
  const proc = useProcessImage();
  const [picked, setPicked] = useState<File | null>(null);

  const log = (id: string, ok: boolean | null, text: string) =>
    setLines((prev) => [...prev.filter((l) => l.id !== id), { id, ok, text }]);

  useEffect(() => {
    const canvas = labCanvasRef.current;
    if (!canvas) return;
    drawGradient(canvas);
    setDemoUrl(canvas.toDataURL("image/png"));
    let cancelled = false;
    (async () => {
      const ctx = canvas.getContext("2d")!;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const struct = { data: pixels.data, width: pixels.width, height: pixels.height };
      const check = async (id: string, fn: () => Promise<string>) => {
        try {
          const detail = await fn();
          if (!cancelled) log(id, true, detail);
        } catch (err) {
          if (!cancelled) log(id, false, err instanceof Error ? err.message : String(err));
        }
      };
      const canvasBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), "image/png"),
      );

      // ---- codecs -------------------------------------------------
      let jpegBytes = new Uint8Array(0);
      await check("jpeg-encode", async () => {
        jpegBytes = bytes(await encodeJpeg(pixels, { quality: 82 }));
        return `${fmtBytes(jpegBytes.length)} · magic ${Array.from(jpegBytes.slice(0, 4)).join(", ")}`;
      });
      await check("jpeg-url", async () => {
        setJpegAssets({
          encodeJsUrl: jpegEncJs,
          encodeWasmUrl: jpegEncWasm,
          decodeJsUrl: jpegDecJs,
          decodeWasmUrl: jpegDecWasm,
        });
        const out = bytes(await encodeJpeg(pixels, { quality: 82 }));
        return `${fmtBytes(out.length)} via setCodecAssets(?url)`;
      });
      await check("jpeg-roundtrip", async () => {
        const back = await decodeJpeg(jpegBytes);
        if (back.width !== pixels.width || back.height !== pixels.height)
          throw new Error(`decoded ${back.width}×${back.height}`);
        return `decoded ${back.width}×${back.height}`;
      });
      let webpBytes = new Uint8Array(0);
      await check("webp-encode", async () => {
        webpBytes = bytes(await encodeWebp(pixels, { quality: 82 }));
        return `${fmtBytes(webpBytes.length)} · ${ascii(webpBytes, 0, 4)} container`;
      });
      await check("webp-roundtrip", async () => {
        const lossless = bytes(await encodeWebp(pixels, { lossless: true }));
        const back = await decodeWebp(lossless);
        if (!samePixels(pixels, back)) throw new Error("pixels differ after lossless roundtrip");
        return `lossless ${fmtBytes(lossless.length)} · pixel-exact`;
      });
      let pngBytes = new Uint8Array(0);
      await check("png-encode", async () => {
        pngBytes = bytes(await encodePng(pixels));
        return `${fmtBytes(pngBytes.length)} · magic ${Array.from(pngBytes.slice(0, 4)).join(", ")}`;
      });
      await check("png-roundtrip", async () => {
        const back = await decodePng(pngBytes);
        if (!samePixels(pixels, back)) throw new Error("pixels differ after roundtrip");
        return "pixel-exact";
      });
      await check("avif-encode", async () => {
        const out = bytes(await encodeAvif(pixels, { quality: 50, speed: 9 }));
        if (ascii(out, 4, 8) !== "ftyp") throw new Error("missing ftyp box");
        return `${fmtBytes(out.length)} · ftyp${ascii(out, 8, 12)}`;
      });
      await check("jxl-roundtrip", async () => {
        const out = bytes(await encodeJxl(pixels, { lossless: true }));
        const back = await decodeJxl(out);
        if (back.width !== pixels.width || back.height !== pixels.height)
          throw new Error(`decoded ${back.width}×${back.height}`);
        return `${fmtBytes(out.length)} · decoded ${back.width}×${back.height}`;
      });
      await check("qoi-roundtrip", async () => {
        const out = bytes(await encodeQoi(pixels));
        const back = await decodeQoi(out);
        if (!samePixels(pixels, back)) throw new Error("pixels differ after roundtrip");
        return `${fmtBytes(out.length)} · pixel-exact`;
      });
      await check("gif-encode", async () => {
        const flipped = toImageData(flipHorizontal(struct));
        const gif = bytes(
          await encodeGif([
            { data: pixels, delay: 120 },
            { data: flipped, delay: 240 },
          ]),
        );
        if (ascii(gif, 0, 4) !== "GIF8") throw new Error("missing GIF8 header");
        const decoded = await decodeGif(gif);
        const optimised = bytes(await optimizeGif(gif));
        return `${fmtBytes(gif.length)} · decoded ${decoded.width}×${decoded.height} · optimised ${fmtBytes(optimised.length)}`;
      });
      await check("heic-decode", async () => {
        const res = await fetch("/sample.heic");
        if (!res.ok) throw new Error(`sample.heic fetch ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (!isHeic(buf)) throw new Error("isHeic rejected the sample");
        const img = await decodeHeic(buf);
        return `sample ${fmtBytes(buf.length)} · decoded ${img.width}×${img.height}`;
      });

      // ---- image tools ---------------------------------------------
      await check("oxipng", async () => {
        const out = bytes(await optimizePng(pngBytes));
        if (out.length >= pngBytes.length) throw new Error("optimised output not smaller");
        return `${fmtBytes(pngBytes.length)} → ${fmtBytes(out.length)}`;
      });
      await check("quantize", async () => {
        const result = await quantize(pixels, { maxColors: 32 });
        if (result.colorCount > 32) throw new Error(`${result.colorCount} colours`);
        return `${result.colorCount} colours used of 32`;
      });
      await check("resize", async () => {
        const out = await resize(pixels, { width: 160, height: 90, filter: "lanczos3" });
        if (out.width !== 160 || out.height !== 90) throw new Error(`${out.width}×${out.height}`);
        return "320×180 → 160×90, lanczos3";
      });
      await check("transform", async () => {
        const tiny = {
          data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
          width: 2,
          height: 1,
        };
        const flipped = flipHorizontal(tiny);
        if (flipped.data[0] !== 0 || flipped.data[4] !== 255) throw new Error("flip order wrong");
        const rotated = rotateQuarter(struct, 1);
        if (rotated.width !== 180 || rotated.height !== 320) throw new Error("rotate dims wrong");
        return "flip swaps pixels · rotate 90° gives 180×320";
      });
      await check("adjust", async () => {
        const grey = grayscale(struct);
        for (let i = 0; i < grey.data.length; i += 997) {
          if (grey.data[i] !== grey.data[i + 1] || grey.data[i] !== grey.data[i + 2])
            throw new Error("channels differ after grayscale");
        }
        return "sampled pixels all have r = g = b";
      });
      await check("metadata", async () => {
        const jpg = buildExifGpsJpeg();
        const info = readMetadata(jpg);
        const gps = info.exif?.gps;
        if (!info.exifPresent || !gps) throw new Error("EXIF/GPS not parsed");
        if (Math.abs(gps.latitude - 28.6) > 1e-9 || Math.abs(gps.longitude + 77.2) > 1e-9)
          throw new Error(`GPS ${gps.latitude}, ${gps.longitude}`);
        if (!hasGps(jpg)) throw new Error("hasGps false");
        const stripped = stripMetadata(jpg);
        if (readMetadata(stripped).exifPresent) throw new Error("strip left EXIF behind");
        return "GPS 28.6, −77.2 parsed · strip removes EXIF";
      });
      await check("watermark", async () => {
        const mark = {
          data: new Uint8ClampedArray(48 * 48 * 4).fill(255),
          width: 48,
          height: 48,
        };
        const out = applyWatermark(struct, mark, { opacity: 1 });
        const i = (132 * out.width + 272) * 4;
        if ((out.data[i] ?? 0) < 240 || (out.data[i + 2] ?? 0) < 240)
          throw new Error("mark not visible at bottom-right");
        return "white mark composited at bottom-right";
      });
      await check("svg", async () => {
        const sample =
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><!-- note --><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>';
        const out = optimizeSvg(sample);
        if (!out.includes("<svg") || out.length >= sample.length)
          throw new Error("not smaller / not svg");
        return `${sample.length} → ${out.length} bytes`;
      });

      // ---- pipeline & platform --------------------------------------
      await check("core-process", async () => {
        const result = await coreProcessImage(canvasBlob, {
          resize: { width: 160 },
          format: "image/webp",
        });
        if (result.blob.type !== "image/webp" || result.width !== 160)
          throw new Error(`${result.blob.type} at ${result.width}px`);
        return `canvas engine → WebP at 160px · ${fmtBytes(result.blob.size)}`;
      });
      await check("pipeline-avif", async () => {
        const result = await processImage(canvasBlob, {
          resize: { width: 160 },
          format: "image/avif",
          codecs: [
            {
              mimeType: "image/avif",
              encode: (data: ImageData) => encodeAvif(data, { quality: 50, speed: 9 }),
            },
          ],
        });
        const head = new Uint8Array(await result.blob.arrayBuffer());
        if (result.format !== "image/avif" || ascii(head, 4, 8) !== "ftyp")
          throw new Error(`format ${result.format}`);
        return `processImage + registered codec → real AVIF · ${fmtBytes(result.blob.size)}`;
      });
      await check("batch", async () => {
        const results = await runBatch([1, 2, 3, 4], async (n) => n * 10, { concurrency: 2 });
        const values = results.map((r) => (r.status === "fulfilled" ? r.value : -1));
        if (values.join(",") !== "10,20,30,40") throw new Error(values.join(","));
        return "4 tasks, concurrency 2, input order preserved";
      });
      await check("crop-geometry", async () => {
        const rect = initialCrop({ width: 1000, height: 500 });
        if (rect.x !== 100 || rect.y !== 50 || rect.width !== 800 || rect.height !== 400)
          throw new Error(JSON.stringify(rect));
        return "initialCrop(1000×500) = 800×400 centred";
      });
      await check("placeholder", async () => {
        const thumb = encodeThumbHash(struct);
        const blur = encodeBlurHash(struct);
        const back = decodeThumbHash(thumb);
        const blurBack = decodeBlurHash(blur, 48, 27);
        const tc = thumbCanvasRef.current;
        if (tc) {
          tc.width = back.width;
          tc.height = back.height;
          tc.getContext("2d")!.putImageData(toImageData(back), 0, 0);
        }
        if (!cancelled) setHashes({ thumb: thumbHashToBase64(thumb), blur });
        return `ThumbHash decoded ${back.width}×${back.height} · BlurHash decoded ${blurBack.width}×${blurBack.height}`;
      });

      (window as unknown as { __DUSREL_TESTS_DONE__: boolean }).__DUSREL_TESTS_DONE__ = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const doneCount = lines.length;
  const failCount = lines.filter((l) => l.ok === false).length;
  const pillState = doneCount < CHECKS.length ? "run" : failCount > 0 ? "fail" : "pass";
  const pillText =
    doneCount < CHECKS.length
      ? `Running checks · ${doneCount}/${CHECKS.length}`
      : failCount > 0
        ? `${failCount} of ${CHECKS.length} checks failed`
        : `All ${CHECKS.length} checks passed`;

  const renderChecks = (group: Group) => (
    <ul className="checks">
      {CHECKS.filter((c) => c.group === group).map((check) => {
        const line = lines.find((l) => l.id === check.id);
        const state = line ? (line.ok ? "pass" : "fail") : "run";
        return (
          <li key={check.id} className="check" data-testid={`lab-${check.id}`}>
            <span className="status-dot" data-state={state} />
            <span className="check-name">{check.name}</span>
            <span className="check-detail" data-ok={line ? String(line.ok) : undefined}>
              {line ? line.text : check.hint}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          @dusrel/image
          <span className="brand-sub">consumer test</span>
        </div>
        <div className="status-pill">
          <span className="status-dot" data-state={pillState} />
          {pillText}
        </div>
      </header>

      <div className="intro">
        <h1>The published packages, exercised in a real app</h1>
        <p className="lede">
          This page is a separate React + Vite project. Nothing here comes from the library's
          monorepo — every package was installed from the npm registry, and all {CHECKS.length}{" "}
          checks below run against the shipped artifacts on page load: every codec, every feature
          package, and the flagship pipeline.
        </p>
        <dl className="facts">
          <div>
            <dt>version</dt>
            <dd>1.0.0</dd>
          </div>
          <div>
            <dt>packages</dt>
            <dd>22 from npm</dd>
          </div>
          <div>
            <dt>checks</dt>
            <dd>{CHECKS.length} in-browser + 43 Node pack-smoke</dd>
          </div>
          <div>
            <dt>backend</dt>
            <dd>none — all client-side</dd>
          </div>
        </dl>
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">01</span>
          <h2>Codec lab</h2>
          <span className="panel-note">every codec package, from the registry</span>
        </div>
        <div className="lab-grid">
          <div>
            <canvas ref={labCanvasRef} className="frame" width={320} height={180} />
            <div className="frame-caption">test image · 320×180 · drawn in code</div>
          </div>
          {renderChecks("codecs")}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">02</span>
          <h2>Image tools</h2>
          <span className="panel-note">feature packages on the same pixels</span>
        </div>
        {renderChecks("tools")}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">03</span>
          <h2>Pipeline and platform</h2>
          <span className="panel-note">core, flagship pipeline, batch, crop, placeholders</span>
        </div>
        {renderChecks("flow")}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">04</span>
          <h2>Placeholders</h2>
          <span className="panel-note">encoded from the same test image</span>
        </div>
        <div className="hash-grid">
          <div>
            {hashes ? (
              <>
                <div className="hash-row">
                  <div className="hash-label">ThumbHash</div>
                  <div className="hash-value" data-testid="thumbhash">
                    {hashes.thumb}
                  </div>
                </div>
                <div className="hash-row">
                  <div className="hash-label">BlurHash</div>
                  <div className="hash-value" data-testid="blurhash">
                    {hashes.blur}
                  </div>
                </div>
              </>
            ) : (
              <p className="waiting">Waiting for the pipeline panel to reach the placeholder step</p>
            )}
          </div>
          <div>
            <canvas ref={thumbCanvasRef} className="thumb-preview" />
            <div className="frame-caption">ThumbHash, decoded back</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">05</span>
          <h2>Process a file</h2>
          <span className="panel-note">useProcessImage · @dusrel/image-react</span>
        </div>
        <div className="controls">
          <label className="file-label">
            Choose an image
            <input
              className="file-input"
              type="file"
              accept="image/*"
              onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
            />
          </label>
          {picked && (
            <span className="file-name">
              {picked.name} · {fmtBytes(picked.size)}
            </span>
          )}
          <button
            className="btn-primary"
            disabled={!picked || proc.status === "processing"}
            onClick={() =>
              picked && void proc.process(picked, { resize: { width: 800 }, format: "image/webp" })
            }
          >
            Resize to 800px WebP
          </button>
        </div>
        <p className="status-line" data-testid="process-status">
          status · {proc.status}
        </p>
        {proc.result && (
          <p className="readout" data-testid="process-result">
            {proc.result.format} · {fmtBytes(proc.result.blob.size)} · {proc.result.width}×
            {proc.result.height} · saved {Math.round((proc.result.report?.savingsRatio ?? 0) * 100)}
            %
          </p>
        )}
        {proc.error != null && (
          <p className="readout readout-error">
            {proc.error instanceof Error ? proc.error.message : String(proc.error)}
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">06</span>
          <h2>Crop component</h2>
          <span className="panel-note">DusrelCrop · @dusrel/image-react</span>
        </div>
        {demoUrl && (
          <div className="crop-wrap">
            <DusrelCrop src={demoUrl} aspect="4/3" onCropChange={setCrop} />
          </div>
        )}
        <p className="readout" data-testid="crop-value">
          {crop ? JSON.stringify(crop) : "no crop yet"}
        </p>
      </section>

      <footer className="footer">
        <a href="https://www.npmjs.com/package/@dusrel/image">@dusrel/image on npm</a>
        <a href="https://github.com/dusmamud/dusrel-image">library source</a>
        <a href="https://github.com/dusmamud/dusrel-consumer-test">this app's source</a>
      </footer>
    </div>
  );
}
