/// <reference types="vite/client" />

declare module 'jscanify/client' {
  export default class JscanifyClient {
    findPaperContour(img: unknown): unknown;
    getCornerPoints(
      contour: unknown,
      img?: unknown,
    ): {
      topLeftCorner?: { x: number; y: number };
      topRightCorner?: { x: number; y: number };
      bottomLeftCorner?: { x: number; y: number };
      bottomRightCorner?: { x: number; y: number };
    };
    extractPaper(
      image: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: {
        topLeftCorner: { x: number; y: number };
        topRightCorner: { x: number; y: number };
        bottomLeftCorner: { x: number; y: number };
        bottomRightCorner: { x: number; y: number };
      },
    ): HTMLCanvasElement | null;
    highlightPaper(image: HTMLCanvasElement | HTMLImageElement, options?: { color?: string; thickness?: number }): HTMLCanvasElement;
  }
}
