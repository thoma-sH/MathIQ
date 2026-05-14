/**
 * Build a single multi-page PDF from N scanned image blobs. Each page is
 * fit into a letter-sized sheet (612×792pt) with a 36pt margin, preserving
 * aspect ratio. Extracted from the existing RawUploadCard generator in
 * Homework.tsx so the scanner, the raw download, and the formatted/exam
 * upload paths all share one assembly path.
 *
 * jsPDF is dynamically imported so this file (and the scanner chunk that
 * imports it) only pulls jspdf when actually used.
 */

interface PdfOptions {
  /** Final filename (".pdf" appended if missing). */
  filename: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const USABLE_W = PAGE_W - 2 * MARGIN;
const USABLE_H = PAGE_H - 2 * MARGIN;

export async function pagesToPdf(blobs: Blob[], opts: PdfOptions): Promise<File> {
  if (blobs.length === 0) {
    throw new Error('pagesToPdf called with zero pages');
  }
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ format: 'letter', unit: 'pt', compress: true });

  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    const dataUrl = await blobToDataUrl(blob);
    const dims = await imageDims(dataUrl);
    const scale = Math.min(USABLE_W / dims.w, USABLE_H / dims.h);
    const drawW = dims.w * scale;
    const drawH = dims.h * scale;
    const x = (PAGE_W - drawW) / 2;
    const y = (PAGE_H - drawH) / 2;
    if (i > 0) doc.addPage();
    const fmt = blob.type === 'image/png' ? 'PNG' : 'JPEG';
    doc.addImage(dataUrl, fmt, x, y, drawW, drawH);
  }

  const arrayBuffer = doc.output('arraybuffer');
  const sanitized = opts.filename.replace(/[^a-z0-9 _.-]/gi, '') || 'Document';
  const finalName = sanitized.toLowerCase().endsWith('.pdf') ? sanitized : sanitized + '.pdf';
  return new File([arrayBuffer], finalName, { type: 'application/pdf' });
}

/** Trigger a browser download for an already-built File. Used by raw
 *  Homework mode (no upload — just save to disk). */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read scanned page.'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function imageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image dimensions'));
    img.src = dataUrl;
  });
}
