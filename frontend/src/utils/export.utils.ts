import type { CanvasElement, StrokeElement, RectangleElement, CircleElement, TextElement } from '../types/canvas.types';
import type Konva from 'konva';

/**
 * Escapes XML/HTML special characters to prevent injection/XSS in SVG attributes and content.
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Calculates the bounding box of a list of canvas elements.
 * Supports strokes with flat number points or {x, y} coordinate objects.
 */
export function calculateElementsBounds(elements: CanvasElement[], padding = 40): BoundingBox {
  if (elements.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 600,
      width: 800,
      height: 600
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (el.type === 'stroke') {
      const stroke = el as StrokeElement;
      if (Array.isArray(stroke.points) && stroke.points.length > 0) {
        if (typeof stroke.points[0] === 'object' && stroke.points[0] !== null) {
          for (const pt of (stroke.points as unknown as Array<{ x: number; y: number }>)) {
            if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
            }
          }
        } else {
          for (let i = 0; i < stroke.points.length; i += 2) {
            const x = stroke.points[i];
            const y = stroke.points[i + 1];
            if (typeof x === 'number' && typeof y === 'number') {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
    } else if (el.type === 'rectangle') {
      const rect = el as RectangleElement;
      if (rect.x < minX) minX = rect.x;
      if (rect.y < minY) minY = rect.y;
      if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
      if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
    } else if (el.type === 'circle') {
      const circle = el as CircleElement;
      if (circle.x - circle.radius < minX) minX = circle.x - circle.radius;
      if (circle.y - circle.radius < minY) minY = circle.y - circle.radius;
      if (circle.x + circle.radius > maxX) maxX = circle.x + circle.radius;
      if (circle.y + circle.radius > maxY) maxY = circle.y + circle.radius;
    } else if (el.type === 'text') {
      const text = el as TextElement;
      const approxWidth = text.text.length * (text.fontSize || 18) * 0.65;
      const approxHeight = (text.fontSize || 18) * 1.3;
      if (text.x < minX) minX = text.x;
      if (text.y < minY) minY = text.y;
      if (text.x + approxWidth > maxX) maxX = text.x + approxWidth;
      if (text.y + approxHeight > maxY) maxY = text.y + approxHeight;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 40;
  minX = Math.floor(minX - pad);
  minY = Math.floor(minY - pad);
  maxX = Math.ceil(maxX + pad);
  maxY = Math.ceil(maxY + pad);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(100, maxX - minX),
    height: Math.max(100, maxY - minY)
  };
}

/**
 * Serializes canvas elements into valid, sanitized SVG markup with an <?xml> declaration and <svg> root.
 */
export function serializeElementsToSvg(elements: CanvasElement[], backgroundColor = '#080c14'): string {
  const bounds = calculateElementsBounds(elements);

  const svgParts: string[] = [];
  svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">`
  );

  // Background rect
  if (backgroundColor && backgroundColor !== 'transparent') {
    svgParts.push(
      `  <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(backgroundColor)}" />`
    );
  }

  if (elements.length === 0) {
    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;
    svgParts.push(
      `  <text x="${cx}" y="${cy}" fill="#9ca3af" font-family="sans-serif" font-size="16" text-anchor="middle">Empty Whiteboard</text>`
    );
  } else {
    for (const el of elements) {
      const opacity = typeof el.opacity === 'number' ? el.opacity : 1;

      if (el.type === 'stroke') {
        const stroke = el as StrokeElement;
        if (Array.isArray(stroke.points) && stroke.points.length >= 2) {
          let pathD: string;
          if (typeof stroke.points[0] === 'object' && stroke.points[0] !== null) {
            const pts = stroke.points as unknown as Array<{ x: number; y: number }>;
            pathD = `M ${pts[0].x} ${pts[0].y}`;
            for (let i = 1; i < pts.length; i++) {
              if (pts[i] && typeof pts[i].x === 'number' && typeof pts[i].y === 'number') {
                pathD += ` L ${pts[i].x} ${pts[i].y}`;
              }
            }
          } else {
            pathD = `M ${stroke.points[0]} ${stroke.points[1]}`;
            for (let i = 2; i < stroke.points.length; i += 2) {
              pathD += ` L ${stroke.points[i]} ${stroke.points[i + 1]}`;
            }
          }
          const strokeColor = escapeXml(stroke.strokeColor || '#f9fafb');
          const strokeWidth = stroke.strokeWidth || 3;
          svgParts.push(
            `  <path d="${pathD}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${opacity}" />`
          );
        }
      } else if (el.type === 'rectangle') {
        const rect = el as RectangleElement;
        const strokeColor = escapeXml(rect.strokeColor || '#6366f1');
        const fillColor = rect.fillColor && rect.fillColor !== 'transparent' ? escapeXml(rect.fillColor) : 'none';
        const strokeWidth = rect.strokeWidth || 2;
        svgParts.push(
          `  <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="4" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="${fillColor}" opacity="${opacity}" />`
        );
      } else if (el.type === 'circle') {
        const circle = el as CircleElement;
        const strokeColor = escapeXml(circle.strokeColor || '#10b981');
        const fillColor = circle.fillColor && circle.fillColor !== 'transparent' ? escapeXml(circle.fillColor) : 'none';
        const strokeWidth = circle.strokeWidth || 2;
        svgParts.push(
          `  <circle cx="${circle.x}" cy="${circle.y}" r="${circle.radius}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="${fillColor}" opacity="${opacity}" />`
        );
      } else if (el.type === 'text') {
        const text = el as TextElement;
        const fill = escapeXml(text.strokeColor || text.fillColor || '#f9fafb');
        const fontSize = text.fontSize || 18;
        const fontFamily = escapeXml(text.fontFamily || 'Inter, sans-serif');
        const escapedContent = escapeXml(text.text);
        // dominant-baseline hanging so top-left aligns with Konva coordinates
        svgParts.push(
          `  <text x="${text.x}" y="${text.y + fontSize}" fill="${fill}" font-size="${fontSize}" font-family="${fontFamily}" opacity="${opacity}">${escapedContent}</text>`
        );
      }
    }
  }

  svgParts.push(`</svg>`);
  return svgParts.join('\n');
}

/**
 * Sanitizes a filename for cross-browser safe file downloads.
 * Strips/replaces characters disallowed in file systems (/ \ : * ? " < > | and control characters),
 * ensures safe fallback if empty, and guarantees the expected file extension.
 */
export function sanitizeDownloadFilename(filename: string, defaultExtension = '.png'): string {
  const ext = defaultExtension.startsWith('.') ? defaultExtension : `.${defaultExtension}`;

  if (!filename || typeof filename !== 'string') {
    return `BoardCollab-export${ext}`;
  }

  // Remove trailing extension if present before sanitizing base name
  let baseName = filename.trim();
  if (baseName.toLowerCase().endsWith(ext.toLowerCase())) {
    baseName = baseName.slice(0, -ext.length);
  }

  // Replace filesystem reserved characters and filter out non-printable control characters
  // Reserved in Windows / Unix: / \ : * ? " < > |
  const printableOnly = Array.from(baseName)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('');
  const sanitized = printableOnly
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, ''); // Remove leading dots

  const finalBase = sanitized.length > 0 ? sanitized : 'BoardCollab-export';
  return `${finalBase}${ext}`;
}

/**
 * Safely triggers a browser file download from a Blob with delayed URL revocation.
 * Avoids premature revocation which causes corrupt 0-byte downloads in Chromium/Firefox.
 * Enforces filename sanitization so Chrome never falls back to the Blob UUID.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const isSvg = blob.type.includes('svg');
  const defaultExt = isSvg ? '.svg' : '.png';
  const cleanFilename = sanitizeDownloadFilename(filename, defaultExt);

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = cleanFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Delay revoking the object URL to allow browser download manager to complete stream
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore cleanup errors
    }
  }, 1000);
}

/**
 * Triggers browser download of generated SVG content with MIME type image/svg+xml;charset=utf-8.
 */
export function downloadSvg(svgContent: string, filename: string): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const sanitizedFilename = sanitizeDownloadFilename(filename, '.svg');
  downloadBlob(blob, sanitizedFilename);
}

/**
 * Converts a data URL string to a binary Blob with specified MIME type.
 * Fallback for environments where HTMLCanvasElement.toBlob is not available.
 */
export function dataUrlToBlob(dataUrl: string, mimeType = 'image/png'): Blob {
  const parts = dataUrl.split(',');
  const byteString = atob(parts[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ia], { type: mimeType });
}

/**
 * Exports Konva Stage as high-res PNG image with background using a binary Blob.
 * Guarantees valid PNG binary data with correct signature and MIME type image/png.
 */
export async function exportStageToPng(stage: Konva.Stage, filename: string, backgroundColor = '#080c14'): Promise<void> {
  // Create an offscreen canvas to combine background color with the Konva stage rendering
  const stageDataUrl = stage.toDataURL({
    pixelRatio: 2,
    mimeType: 'image/png'
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = stageDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // Draw consistent background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw stage image on top
  ctx.drawImage(img, 0, 0);

  // Convert offscreen canvas to binary Blob with MIME type image/png
  const blob = await new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((b) => {
        if (b) {
          resolve(b);
        } else {
          try {
            resolve(dataUrlToBlob(canvas.toDataURL('image/png'), 'image/png'));
          } catch {
            reject(new Error('Failed to create PNG blob from canvas'));
          }
        }
      }, 'image/png');
    } else {
      try {
        resolve(dataUrlToBlob(canvas.toDataURL('image/png'), 'image/png'));
      } catch (err: unknown) {
        reject(err);
      }
    }
  });

  const sanitizedFilename = sanitizeDownloadFilename(filename, '.png');
  downloadBlob(blob, sanitizedFilename);
}

/**
 * Exports room canvas via the authenticated backend endpoint POST /api/rooms/:id/export.
 * Checks for HTTP errors before downloading so error JSON responses are never saved as PNGs.
 */
export async function downloadServerExportPng(
  roomId: string,
  filename?: string,
  options?: { backgroundColor?: string; padding?: number; allowEmpty?: boolean }
): Promise<void> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('boardcollab_token') : null;
  const API_BASE_URL = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:5000').replace(/\/+$/, '');
  const url = `${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/export`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(options || {})
  });

  if (!response.ok) {
    let errorMessage = `Server export failed with status ${response.status}`;
    try {
      const err = await response.json();
      if (err?.message) errorMessage = err.message;
    } catch {
      // Body was not JSON
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('image/png')) {
    throw new Error(`Unexpected server response format: ${contentType}, expected image/png`);
  }

  const rawBlob = await response.blob();
  const pngBlob = rawBlob.type === 'image/png' ? rawBlob : new Blob([rawBlob], { type: 'image/png' });
  const rawFilename = filename || `BoardCollab-${roomId}.png`;
  const sanitizedFilename = sanitizeDownloadFilename(rawFilename, '.png');

  downloadBlob(pngBlob, sanitizedFilename);
}

