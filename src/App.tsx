import { useEffect, useRef, useState } from "react";
import { DusrelCrop, useProcessImage } from "@dusrel/image-react";
import { encode as encodeJpeg, setCodecAssets as setJpegAssets } from "@dusrel/image-jpeg";
import { encode as encodeWebp } from "@dusrel/image-webp";
import { encode as encodePng } from "@dusrel/image-png";
import {
  decodeBlurHash,
  decodeThumbHash,
  encodeBlurHash,
  encodeThumbHash,
  thumbHashToBase64,
} from "@dusrel/image-placeholder";
import type { CropRect } from "@dusrel/image-crop";
import { toImageData } from "@dusrel/image";
// The documented escape hatch for bundlers: hand the codec loader
// bundler-emitted asset URLs instead of its import.meta.url defaults.
import jpegEncJs from "@dusrel/image-jpeg/codec/mozjpeg_enc.js?url";
import jpegEncWasm from "@dusrel/image-jpeg/codec/mozjpeg_enc.wasm?url";
import jpegDecJs from "@dusrel/image-jpeg/codec/mozjpeg_dec.js?url";
import jpegDecWasm from "@dusrel/image-jpeg/codec/mozjpeg_dec.wasm?url";

type LabLine = { id: string; ok: boolean | null; text: string };

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
      const run = async (id: string, label: string, fn: () => Promise<Uint8Array>) => {
        try {
          const out = await fn();
          if (!cancelled)
            log(id, true, `${label}: OK (${out.length} bytes, magic ${Array.from(out.slice(0, 4)).join(",")})`);
        } catch (err) {
          if (!cancelled) log(id, false, `${label}: FAILED (${err instanceof Error ? err.message : String(err)})`);
        }
      };
      // 1) Default asset resolution (new URL relative to import.meta.url)
      await run("jpeg-default", "JPEG encode, default assets", async () =>
        new Uint8Array(await encodeJpeg(pixels, { quality: 82 })),
      );
      await run("webp-default", "WebP encode, default assets", async () =>
        new Uint8Array(await encodeWebp(pixels, { quality: 82 })),
      );
      await run("png-default", "PNG encode, default assets", async () =>
        new Uint8Array(await encodePng(pixels)),
      );
      // 2) The ?url escape hatch for the same JPEG codec
      setJpegAssets({
        encodeJsUrl: jpegEncJs,
        encodeWasmUrl: jpegEncWasm,
        decodeJsUrl: jpegDecJs,
        decodeWasmUrl: jpegDecWasm,
      });
      await run("jpeg-url", "JPEG encode, ?url assets", async () =>
        new Uint8Array(await encodeJpeg(pixels, { quality: 82 })),
      );
      // 3) Placeholders from the same pixels
      try {
        const small = { data: pixels.data, width: pixels.width, height: pixels.height };
        const thumb = encodeThumbHash(small);
        const blur = encodeBlurHash(small);
        const back = decodeThumbHash(thumb);
        const blurBack = decodeBlurHash(blur, 48, 27);
        const tc = thumbCanvasRef.current;
        if (tc) {
          tc.width = back.width;
          tc.height = back.height;
          tc.getContext("2d")!.putImageData(toImageData(back), 0, 0);
        }
        if (!cancelled) {
          setHashes({ thumb: thumbHashToBase64(thumb), blur });
          log("placeholder", true, `Placeholders: OK (thumbhash decode ${back.width}x${back.height}, blurhash decode ${blurBack.width}x${blurBack.height})`);
        }
      } catch (err) {
        if (!cancelled)
          log("placeholder", false, `Placeholders: FAILED (${err instanceof Error ? err.message : String(err)})`);
      }
      (window as unknown as { __DUSREL_TESTS_DONE__: boolean }).__DUSREL_TESTS_DONE__ = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", margin: "2rem auto", maxWidth: 880, padding: "0 1rem" }}>
      <h1>@dusrel/image — consumer test (React + Vite)</h1>
      <p>
        Every package below was installed from the npm registry at version 1.0.0. The codec lab
        runs automatically on page load.
      </p>

      <h2>Codec lab</h2>
      <canvas ref={labCanvasRef} width={320} height={180} style={{ border: "1px solid #888" }} />
      <ul>
        {lines.map((l) => (
          <li key={l.id} data-testid={`lab-${l.id}`} style={{ color: l.ok === null ? "#666" : l.ok ? "green" : "crimson" }}>
            {l.text}
          </li>
        ))}
      </ul>
      {hashes && (
        <div>
          <p>
            ThumbHash: <code data-testid="thumbhash">{hashes.thumb}</code>
          </p>
          <p>
            BlurHash: <code data-testid="blurhash">{hashes.blur}</code>
          </p>
          <canvas ref={thumbCanvasRef} style={{ border: "1px solid #888", width: 96 }} />
        </div>
      )}

      <h2>Process a file (useProcessImage)</h2>
      <input type="file" accept="image/*" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
      <button
        disabled={!picked || proc.status === "processing"}
        onClick={() => picked && void proc.process(picked, { resize: { width: 800 }, format: "image/webp" })}
      >
        Resize to 800px WebP
      </button>
      <p data-testid="process-status">status: {proc.status}</p>
      {proc.result && (
        <p data-testid="process-result">
          {proc.result.format}: {proc.result.blob.size} bytes, {proc.result.width}x{proc.result.height},
          saved {Math.round((proc.result.report?.savingsRatio ?? 0) * 100)}%
        </p>
      )}
      {proc.error != null && (
        <p style={{ color: "crimson" }}>
          {proc.error instanceof Error ? proc.error.message : String(proc.error)}
        </p>
      )}

      <h2>Crop component (DusrelCrop)</h2>
      {demoUrl && (
        <div style={{ width: 480 }}>
          <DusrelCrop src={demoUrl} aspect="4/3" onCropChange={setCrop} />
        </div>
      )}
      <p data-testid="crop-value">{crop ? JSON.stringify(crop) : "no crop yet"}</p>
    </main>
  );
}
