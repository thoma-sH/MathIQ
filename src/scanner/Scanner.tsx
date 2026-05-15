/**
 * Scanner — the universal image-capture surface.
 *
 * One modal handles three shapes of output:
 *  - single image (OCR surfaces)
 *  - array of images (Homework raw mode)
 *  - assembled multi-page PDF (Homework formatted, Exam grading)
 *
 * The live camera path streams from the rear camera and snapshots the
 * full video frame on capture. If the camera is unavailable or permission
 * is denied, the modal falls back to a library-only mode driven by the
 * file picker.
 *
 * Mounted via `openScanner()` in index.ts — this component is never
 * imported by a screen directly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '../design/tokens';
import { pagesToPdf } from './scanToPdf';

const CAPTURE_JPEG_QUALITY = 0.92;

export type ScannerOutput =
  | { kind: 'image'; file: File }
  | { kind: 'images'; files: File[] }
  | { kind: 'pdf'; file: File; pageCount: number };

export interface ScannerOptions {
  mode: 'single' | 'multi';
  output: 'image' | 'images' | 'pdf';
  filename?: string;
}

interface ScannerProps extends ScannerOptions {
  onComplete: (out: ScannerOutput) => void;
  onCancel: () => void;
}

interface ScannedPage {
  id: string;
  blob: Blob;
  objectUrl: string;
}

type CameraState = 'pending' | 'live' | 'denied' | 'unsupported';

export function Scanner({ mode, output, filename, onComplete, onCancel }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [camera, setCamera] = useState<CameraState>('pending');
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [reviewPage, setReviewPage] = useState<ScannedPage | null>(null);
  const [processing, setProcessing] = useState<'capturing' | 'finalizing' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teardownCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Mount: try to open the rear camera. If anything fails, fall back to
  // library-only mode (the user can still upload via file picker).
  useEffect(() => {
    let cancelled = false;

    // Hard timeout so we never hang on "Opening camera…" — iOS PWAs in
    // particular sometimes swallow the permission prompt and getUserMedia
    // resolves neither way. After 6s we assume the prompt is stuck and
    // surface the library-only fallback.
    const stuckTimer = window.setTimeout(() => {
      if (cancelled) return;
      setCamera((current) => (current === 'pending' ? 'unsupported' : current));
    }, 6000);

    async function startCamera() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setCamera('unsupported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute('playsinline', '');
          video.muted = true;
          try {
            await video.play();
          } catch {
            // Some Safari versions throw when play() races with srcObject
            // assignment. The 'playing' event will still fire — ignore.
          }
        }
        window.clearTimeout(stuckTimer);
        setCamera('live');
      } catch (err) {
        if (cancelled) return;
        window.clearTimeout(stuckTimer);
        const name = err instanceof Error ? err.name : '';
        setCamera(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unsupported');
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      window.clearTimeout(stuckTimer);
      teardownCamera();
    };
  }, [teardownCamera]);

  // Capture a frame at native video resolution and route into review
  // (single) or directly into pages (multi). The final upload-prep resize
  // happens in finalize() via prepareImageForUpload.
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || processing) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    setProcessing('capturing');

    try {
      const fullFrame = document.createElement('canvas');
      fullFrame.width = vw;
      fullFrame.height = vh;
      const ctx = fullFrame.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable.');
      ctx.drawImage(video, 0, 0, vw, vh);
      const blob = await canvasToJpegBlob(fullFrame);
      addCapturedPage(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setProcessing(null);
    }
  }, [processing]);

  function addCapturedPage(blob: Blob) {
    const page: ScannedPage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      blob,
      objectUrl: URL.createObjectURL(blob),
    };
    if (mode === 'single') {
      // Single-shot — drop into review; accept closes the modal.
      setReviewPage(page);
    } else {
      setPages((prev) => [...prev, page]);
      // Multi-shot doesn't review by default; user can retake by removing
      // from the thumbnail strip.
    }
  }

  // Library picker — reads the picked images and drops them in pages
  // (multi) or review (single). Mathpix / Claude vision handle layout on
  // the server, so we don't pre-deskew client-side.
  async function onLibraryPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProcessing('capturing');
    setError(null);
    try {
      const accepted: Blob[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const canvas = await loadImageToCanvas(file);
        const blob = await canvasToJpegBlob(canvas);
        accepted.push(blob);
        if (mode === 'single') break;
      }
      if (accepted.length === 0) {
        setError('Pick a JPG, PNG, WebP, or HEIC image.');
        return;
      }
      if (mode === 'single') {
        const blob = accepted[0];
        const page: ScannedPage = {
          id: `${Date.now()}-lib`,
          blob,
          objectUrl: URL.createObjectURL(blob),
        };
        setReviewPage(page);
      } else {
        setPages((prev) => [
          ...prev,
          ...accepted.map((blob, i) => ({
            id: `${Date.now()}-lib-${i}`,
            blob,
            objectUrl: URL.createObjectURL(blob),
          })),
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Library import failed.');
    } finally {
      setProcessing(null);
    }
  }

  function acceptReview() {
    if (!reviewPage) return;
    if (mode === 'single') {
      void finalize([reviewPage]);
    } else {
      setPages((prev) => [...prev, reviewPage]);
      setReviewPage(null);
    }
  }

  function retakeReview() {
    if (!reviewPage) return;
    URL.revokeObjectURL(reviewPage.objectUrl);
    setReviewPage(null);
  }

  function removePage(id: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function finishMulti() {
    if (pages.length === 0) return;
    await finalize(pages);
  }

  async function finalize(allPages: ScannedPage[]) {
    setProcessing('finalizing');
    setError(null);
    try {
      const { prepareImageForUpload } = await import('../walkthroughs/homework');
      const files: File[] = [];
      for (let i = 0; i < allPages.length; i++) {
        const blob = allPages[i].blob;
        const sourceFile = new File([blob], `scan-${i + 1}.jpg`, { type: 'image/jpeg' });
        const normalized = await prepareImageForUpload(sourceFile);
        files.push(new File([normalized.blob], sourceFile.name, { type: normalized.mediaType }));
      }
      let out: ScannerOutput;
      if (output === 'pdf') {
        const pdfFile = await pagesToPdf(
          files.map((f) => f),
          { filename: filename ?? 'Scan.pdf' },
        );
        out = { kind: 'pdf', file: pdfFile, pageCount: files.length };
      } else if (output === 'images') {
        out = { kind: 'images', files };
      } else {
        out = { kind: 'image', file: files[0] };
      }
      // Release object URLs before unmount.
      allPages.forEach((p) => URL.revokeObjectURL(p.objectUrl));
      onComplete(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assemble the scan.');
      setProcessing(null);
    }
  }

  function cancel() {
    pages.forEach((p) => URL.revokeObjectURL(p.objectUrl));
    if (reviewPage) URL.revokeObjectURL(reviewPage.objectUrl);
    onCancel();
  }

  const showLiveCamera = camera === 'live' && !reviewPage;
  const showReview = !!reviewPage;
  const showLibraryOnly = camera === 'denied' || camera === 'unsupported';

  return (
    <div
      role="dialog"
      aria-label="Document scanner"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0a0f0a',
        color: T.paper,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: T.sans,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          background: 'rgba(0,0,0,0.45)',
          borderBottom: `1px solid rgba(212, 226, 106, 0.18)`,
        }}
      >
        <button
          type="button"
          onClick={cancel}
          className="btn-press"
          style={{
            background: 'transparent',
            border: `1px solid ${T.paper}`,
            color: T.paper,
            padding: '8px 14px',
            fontSize: 13,
            fontFamily: T.mono,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          ← Cancel
        </button>
        <div
          style={{
            fontSize: 11,
            fontFamily: T.mono,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}
        >
          Scan
          {pages.length > 0 && ` · ${pages.length} page${pages.length === 1 ? '' : 's'}`}
        </div>
        {mode === 'multi' && pages.length > 0 ? (
          <button
            type="button"
            onClick={() => void finishMulti()}
            disabled={processing === 'finalizing'}
            className="btn-press chamfer"
            style={{
              background: T.accent,
              border: 'none',
              color: T.paper,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: processing === 'finalizing' ? 'wait' : 'pointer',
              fontFamily: T.sans,
            }}
          >
            {processing === 'finalizing' ? 'Saving…' : `Done →`}
          </button>
        ) : (
          <span style={{ width: 72 }} aria-hidden />
        )}
      </header>

      <div
        ref={stageRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
        }}
      >
        {camera === 'pending' && (
          <div style={{ textAlign: 'center', padding: 24, color: T.paper }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                fontFamily: T.sans,
                marginBottom: 10,
              }}
            >
              Opening camera…
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>
              Allow camera access when prompted — or tap{' '}
              <strong>Cancel</strong> and try again with a file picker.
            </div>
          </div>
        )}

        {showLibraryOnly && !reviewPage && (
          <div style={{ textAlign: 'center', padding: 32, maxWidth: 360 }}>
            <div
              style={{
                fontSize: 11,
                fontFamily: T.mono,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                opacity: 0.7,
                marginBottom: 12,
              }}
            >
              {camera === 'denied' ? 'Camera blocked' : 'No camera available'}
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.55, opacity: 0.85, margin: '0 0 18px' }}>
              {camera === 'denied'
                ? 'Allow camera access in your browser, or pick a photo from your library.'
                : 'Pick a photo from your library to continue.'}
            </p>
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              className="btn-press chamfer"
              style={{
                background: T.accent,
                border: 'none',
                color: T.paper,
                padding: '12px 22px',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: T.sans,
              }}
            >
              {mode === 'multi' ? 'Pick photos →' : 'Pick a photo →'}
            </button>
            {camera === 'denied' && (
              <button
                type="button"
                onClick={() => setCamera('pending')}
                className="btn-press"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: T.paper,
                  padding: '14px 8px 0',
                  fontSize: 12,
                  fontFamily: T.mono,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  opacity: 0.7,
                  display: 'block',
                  margin: '0 auto',
                }}
              >
                Try camera again
              </button>
            )}
          </div>
        )}

        {showReview && reviewPage && (
          <img
            src={reviewPage.objectUrl}
            alt="Captured page preview"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        )}

        {!showReview && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                display: showLiveCamera ? 'block' : 'none',
                background: '#000',
              }}
            />
            {processing === 'capturing' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontFamily: T.mono,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}
              >
                Processing…
              </div>
            )}
          </>
        )}
      </div>

      {mode === 'multi' && pages.length > 0 && !reviewPage && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 12px',
            overflowX: 'auto',
            background: 'rgba(0,0,0,0.55)',
            borderTop: `1px solid rgba(212, 226, 106, 0.18)`,
          }}
        >
          {pages.map((p, i) => (
            <div key={p.id} style={{ position: 'relative', flex: '0 0 auto' }}>
              <img
                src={p.objectUrl}
                alt={`Page ${i + 1}`}
                style={{
                  width: 72,
                  height: 90,
                  objectFit: 'cover',
                  border: `1px solid ${T.paper}`,
                }}
              />
              <button
                type="button"
                onClick={() => removePage(p.id)}
                aria-label={`Remove page ${i + 1}`}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: `1px solid ${T.paper}`,
                  background: '#0a0f0a',
                  color: T.paper,
                  fontSize: 12,
                  lineHeight: '20px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <footer
        style={{
          padding: '16px 16px 24px',
          background: 'rgba(0,0,0,0.55)',
          borderTop: `1px solid rgba(212, 226, 106, 0.18)`,
        }}
      >
        {error && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginBottom: 12,
              padding: '8px 12px',
              border: `1px solid ${T.paper}`,
              fontSize: 13,
              fontFamily: T.mono,
              color: T.paper,
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            {error}
          </div>
        )}

        {showReview ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={retakeReview}
              className="btn-press chamfer"
              style={{
                background: 'transparent',
                border: `1px solid ${T.paper}`,
                color: T.paper,
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: T.sans,
                flex: 1,
              }}
            >
              Retake
            </button>
            <button
              type="button"
              onClick={acceptReview}
              disabled={processing === 'finalizing'}
              className="btn-press chamfer"
              style={{
                background: T.accent,
                border: 'none',
                color: T.paper,
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 600,
                cursor: processing === 'finalizing' ? 'wait' : 'pointer',
                fontFamily: T.sans,
                flex: 1,
              }}
            >
              {processing === 'finalizing'
                ? 'Saving…'
                : mode === 'single'
                  ? 'Use this →'
                  : 'Add page →'}
            </button>
          </div>
        ) : showLibraryOnly ? null : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              disabled={processing !== null}
              className="btn-press"
              style={{
                background: 'transparent',
                border: `1px solid ${T.paper}`,
                color: T.paper,
                padding: '10px 14px',
                fontSize: 12,
                fontFamily: T.mono,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: processing !== null ? 'wait' : 'pointer',
                minWidth: 96,
              }}
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => void capture()}
              disabled={camera !== 'live' || processing !== null}
              aria-label="Capture page"
              className="btn-press"
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: T.paper,
                border: `4px solid #0a0f0a`,
                boxShadow: `0 0 0 3px ${T.paper}`,
                cursor: camera === 'live' && processing === null ? 'pointer' : 'not-allowed',
                opacity: camera === 'live' && processing === null ? 1 : 0.5,
                padding: 0,
              }}
            />
            <span style={{ minWidth: 96, textAlign: 'right', fontSize: 11, fontFamily: T.mono, letterSpacing: '0.1em', opacity: 0.7 }}>
              {mode === 'multi' ? 'Scan each page' : 'One page'}
            </span>
          </div>
        )}
      </footer>

      <input
        ref={libraryInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
        multiple={mode === 'multi'}
        style={{ display: 'none' }}
        onChange={(e) => {
          void onLibraryPick(e.target.files);
          if (e.target) e.target.value = '';
        }}
      />
    </div>
  );
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode capture.'))),
      'image/jpeg',
      CAPTURE_JPEG_QUALITY,
    );
  });
}

async function loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Failed to read the picked photo.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
