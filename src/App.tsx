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

const CHECKS: { id: string; name: string; hint: string }[] = [
  { id: "jpeg-default", name: "JPEG encode", hint: "MozJPEG, default asset URLs" },
  { id: "webp-default", name: "WebP encode", hint: "libwebp, default asset URLs" },
  { id: "png-default", name: "PNG encode", hint: "Rust png crate, default asset URLs" },
  { id: "jpeg-url", name: "JPEG encode", hint: "MozJPEG, setCodecAssets with ?url imports" },
  { id: "placeholder", name: "Placeholders", hint: "ThumbHash and BlurHash roundtrip" },
];

const fmtBytes = (n: number) => `${n.toLocaleString("en-US")} bytes`;

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
      const run = async (id: string, fn: () => Promise<Uint8Array>) => {
        try {
          const out = await fn();
          if (!cancelled)
            log(id, true, `${fmtBytes(out.length)} · magic ${Array.from(out.slice(0, 4)).join(", ")}`);
        } catch (err) {
          if (!cancelled) log(id, false, err instanceof Error ? err.message : String(err));
        }
      };
      // 1) Default asset resolution (new URL relative to import.meta.url)
      await run("jpeg-default", async () =>
        new Uint8Array(await encodeJpeg(pixels, { quality: 82 })),
      );
      await run("webp-default", async () =>
        new Uint8Array(await encodeWebp(pixels, { quality: 82 })),
      );
      await run("png-default", async () => new Uint8Array(await encodePng(pixels)));
      // 2) The ?url escape hatch for the same JPEG codec
      setJpegAssets({
        encodeJsUrl: jpegEncJs,
        encodeWasmUrl: jpegEncWasm,
        decodeJsUrl: jpegDecJs,
        decodeWasmUrl: jpegDecWasm,
      });
      await run("jpeg-url", async () =>
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
          log(
            "placeholder",
            true,
            `ThumbHash decoded ${back.width}×${back.height} · BlurHash decoded ${blurBack.width}×${blurBack.height}`,
          );
        }
      } catch (err) {
        if (!cancelled)
          log("placeholder", false, err instanceof Error ? err.message : String(err));
      }
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
          monorepo — every package was installed from the npm registry, and the codec lab below
          runs against the shipped WASM artifacts on page load.
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
            <dt>stack</dt>
            <dd>React + Vite + TypeScript</dd>
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
          <span className="panel-note">runs automatically on load</span>
        </div>
        <div className="lab-grid">
          <div>
            <canvas ref={labCanvasRef} className="frame" width={320} height={180} />
            <div className="frame-caption">test image · 320×180 · drawn in code</div>
          </div>
          <ul className="checks">
            {CHECKS.map((check) => {
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
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-index">02</span>
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
              <p className="waiting">Waiting for the codec lab to reach the placeholder step</p>
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
          <span className="panel-index">03</span>
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
          <span className="panel-index">04</span>
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
