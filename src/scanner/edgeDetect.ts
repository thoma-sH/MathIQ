/**
 * jscanify + OpenCV.js wrapper for live document edge detection.
 *
 * Lazy-loaded: nothing in this file runs until `loadScanner()` is called
 * for the first time. OpenCV.js (~10MB wasm) is injected via a script tag
 * pointing at the pinned static asset at /opencv/opencv.js — that asset
 * lives under public/opencv/ so Vite serves it verbatim and the URL has a
 * stable hash for caching.
 *
 * jscanify itself ships as a UMD; the `jscanify/client` entry is the
 * browser build (the default export pulls in node-canvas + jsdom, which
 * would explode the bundle).
 */

const OPENCV_SRC = '/opencv/opencv.js';
const OPENCV_TIMEOUT_MS = 30000;

export interface Point { x: number; y: number }
export interface Quad { tl: Point; tr: Point; br: Point; bl: Point }

interface Loaded {
  scanner: JscanifyInstance;
  cv: OpenCvNamespace;
}

interface JscanifyInstance {
  findPaperContour(img: OpenCvMat): OpenCvMat | null;
  getCornerPoints(contour: OpenCvMat, img?: OpenCvMat): {
    topLeftCorner?: Point;
    topRightCorner?: Point;
    bottomLeftCorner?: Point;
    bottomRightCorner?: Point;
  };
  extractPaper(
    image: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
    resultWidth: number,
    resultHeight: number,
    cornerPoints?: {
      topLeftCorner: Point;
      topRightCorner: Point;
      bottomLeftCorner: Point;
      bottomRightCorner: Point;
    },
  ): HTMLCanvasElement | null;
}

interface OpenCvMat {
  delete(): void;
}

interface OpenCvNamespace {
  Mat: new (...args: unknown[]) => OpenCvMat;
  imread(source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): OpenCvMat;
  // Other members exist but jscanify uses them, not us.
}

let cached: Promise<Loaded> | null = null;

export function loadScanner(): Promise<Loaded> {
  if (cached) return cached;
  cached = (async () => {
    const cv = await loadOpenCv();
    const mod = await import('jscanify/client');
    const modAny = mod as unknown as { default?: new () => JscanifyInstance };
    const Jscanify = modAny.default ?? (mod as unknown as new () => JscanifyInstance);
    const scanner = new Jscanify();
    return { scanner, cv };
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

function loadOpenCv(): Promise<OpenCvNamespace> {
  const w = window as unknown as { cv?: OpenCvNamespace };
  if (w.cv && w.cv.Mat) return Promise.resolve(w.cv);

  return new Promise((resolve, reject) => {
    let tag = document.querySelector<HTMLScriptElement>('script[data-opencv]');
    if (!tag) {
      tag = document.createElement('script');
      tag.src = OPENCV_SRC;
      tag.async = true;
      tag.dataset.opencv = '1';
      document.head.appendChild(tag);
    }

    const poll = window.setInterval(() => {
      if (w.cv && w.cv.Mat) {
        window.clearInterval(poll);
        window.clearTimeout(timeout);
        resolve(w.cv);
      }
    }, 50);

    const timeout = window.setTimeout(() => {
      window.clearInterval(poll);
      reject(new Error('opencv.js failed to initialize within 30s'));
    }, OPENCV_TIMEOUT_MS);

    tag.addEventListener('error', () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      reject(new Error('Failed to load opencv.js'));
    });
  });
}

/**
 * Find the dominant rectangular paper-like contour in the source canvas.
 * Returns null if no plausible quad is found. Coordinates are in the
 * source canvas's pixel space.
 */
export async function detectQuad(canvas: HTMLCanvasElement): Promise<Quad | null> {
  const { scanner, cv } = await loadScanner();
  const img = cv.imread(canvas);
  try {
    const contour = scanner.findPaperContour(img);
    if (!contour) return null;
    try {
      const c = scanner.getCornerPoints(contour, img);
      if (!c.topLeftCorner || !c.topRightCorner || !c.bottomLeftCorner || !c.bottomRightCorner) {
        return null;
      }
      return {
        tl: { x: c.topLeftCorner.x, y: c.topLeftCorner.y },
        tr: { x: c.topRightCorner.x, y: c.topRightCorner.y },
        br: { x: c.bottomRightCorner.x, y: c.bottomRightCorner.y },
        bl: { x: c.bottomLeftCorner.x, y: c.bottomLeftCorner.y },
      };
    } finally {
      // findPaperContour returns a Mat; we own it now.
      contour.delete();
    }
  } finally {
    img.delete();
  }
}

/**
 * Perspective-correct + crop the source to the given quad. Output
 * dimensions follow the quad's aspect ratio (so portrait paper produces a
 * portrait result), capped at maxEdge.
 *
 * If quad is null we still attempt detection inside jscanify; if that
 * also fails we render the full source canvas at maxEdge.
 */
export async function extractAndRectify(
  source: HTMLCanvasElement,
  quad: Quad | null,
  maxEdge = 2000,
): Promise<HTMLCanvasElement> {
  const { scanner } = await loadScanner();
  const dims = quad
    ? computeOutputDims(quad, maxEdge)
    : { w: capDim(source.width, maxEdge), h: capDim(source.height, maxEdge) };

  if (quad) {
    const out = scanner.extractPaper(source, dims.w, dims.h, {
      topLeftCorner: quad.tl,
      topRightCorner: quad.tr,
      bottomLeftCorner: quad.bl,
      bottomRightCorner: quad.br,
    });
    if (out) return out;
  }
  return fullFrameCopy(source, dims.w, dims.h);
}

function computeOutputDims(quad: Quad, maxEdge: number): { w: number; h: number } {
  const widthTop = Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y);
  const widthBot = Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y);
  const heightL = Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y);
  const heightR = Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y);
  const w = (widthTop + widthBot) / 2;
  const h = (heightL + heightR) / 2;
  const longest = Math.max(w, h);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

function capDim(value: number, maxEdge: number): number {
  return value > maxEdge ? maxEdge : value;
}

function fullFrameCopy(source: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, w, h);
  return out;
}

/**
 * Compute the area (in source-canvas pixels²) of the quad. Used by the
 * snap-to-stillness logic to discard tiny accidental detections.
 */
export function quadArea(q: Quad): number {
  // Shoelace formula over (tl, tr, br, bl).
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
  const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    sum += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(sum) / 2;
}

/**
 * Largest fractional difference between two quads, normalized by the
 * frame's longest edge. Used for stillness detection.
 */
export function quadDelta(a: Quad, b: Quad, frameLongEdge: number): number {
  const pairs: [Point, Point][] = [
    [a.tl, b.tl], [a.tr, b.tr], [a.br, b.br], [a.bl, b.bl],
  ];
  let max = 0;
  for (const [p1, p2] of pairs) {
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (d > max) max = d;
  }
  return frameLongEdge > 0 ? max / frameLongEdge : 0;
}
