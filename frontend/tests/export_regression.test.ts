import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  serializeElementsToSvg,
  downloadSvg,
  dataUrlToBlob,
  downloadServerExportPng,
  sanitizeDownloadFilename,
  downloadBlob
} from '../src/utils/export.utils.ts';
import type { CanvasElement } from '../src/types/canvas.types.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('Frontend Whiteboard Export Regression Tests', () => {
  describe('1. SVG Serialization & XML Root Validation', () => {
    it('generates valid XML with <svg> root and </svg> closing tag for empty canvas', () => {
      const svg = serializeElementsToSvg([]);

      assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must start with XML declaration');
      assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'Must have <svg> root element');
      assert.ok(svg.endsWith('</svg>'), 'Must terminate with </svg>');
      assert.ok(svg.includes('Empty Whiteboard'), 'Empty whiteboard has placeholder text');
    });

    it('generates valid XML for canvas with stroke, rectangle, circle, and text', () => {
      const elements: CanvasElement[] = [
        {
          id: 'stroke-flat',
          type: 'stroke',
          points: [10, 20, 30, 40, 50, 60],
          strokeColor: '#3b82f6',
          strokeWidth: 4
        },
        {
          id: 'stroke-obj',
          type: 'stroke',
          points: [{ x: 100, y: 110 }, { x: 130, y: 140 }] as unknown as number[],
          strokeColor: '#ef4444',
          strokeWidth: 3
        },
        {
          id: 'rect-1',
          type: 'rectangle',
          x: 200,
          y: 200,
          width: 150,
          height: 100,
          strokeColor: '#10b981',
          fillColor: '#34d399',
          strokeWidth: 2
        },
        {
          id: 'circle-1',
          type: 'circle',
          x: 400,
          y: 400,
          radius: 50,
          strokeColor: '#8b5cf6',
          fillColor: '#a78bfa',
          strokeWidth: 2
        },
        {
          id: 'text-1',
          type: 'text',
          x: 500,
          y: 200,
          text: 'Regression Test <BoardCollab>',
          fontSize: 20,
          strokeColor: '#ffffff'
        }
      ];

      const svg = serializeElementsToSvg(elements);

      assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.ok(svg.includes('<path d="M 10 20 L 30 40 L 50 60"'));
      assert.ok(svg.includes('<path d="M 100 110 L 130 140"'));
      assert.ok(svg.includes('<rect x="200" y="200" width="150" height="100"'));
      assert.ok(svg.includes('<circle cx="400" cy="400" r="50"'));
      assert.ok(svg.includes('<text x="500"'));
      assert.ok(svg.includes('Regression Test &lt;BoardCollab&gt;'), 'XML entities must be escaped');
      assert.ok(svg.endsWith('</svg>'));
    });
  });

  describe('2. SVG Download & Delayed Blob URL Revocation', () => {
    it('creates Blob with MIME type image/svg+xml;charset=utf-8 and delays URL revocation', async () => {
      let createdBlob: Blob | null = null;
      let createdUrl = '';
      let revokeCalled = false;
      let clickedHref = '';
      let clickedDownload = '';

      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const originalDoc = (globalThis as unknown as { document?: unknown }).document;

      URL.createObjectURL = (blob: Blob) => {
        createdBlob = blob;
        createdUrl = 'blob:http://localhost:5173/mock-svg-uuid';
        return createdUrl;
      };

      URL.revokeObjectURL = (url: string) => {
        if (url === createdUrl) {
          revokeCalled = true;
        }
      };

      // Mock DOM element creation
      (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => {
          if (tag === 'a') {
            return {
              href: '',
              download: '',
              click: function (this: { href: string; download: string }) {
                clickedHref = this.href;
                clickedDownload = this.download;
              }
            };
          }
          return {};
        },
        body: {
          appendChild: () => {},
          removeChild: () => {}
        }
      };

      try {
        const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
        downloadSvg(svgContent, 'test-board');

        assert.ok(createdBlob, 'A Blob must be created');
        assert.strictEqual(createdBlob!.type, 'image/svg+xml;charset=utf-8', 'Blob MIME type must be image/svg+xml;charset=utf-8');
        assert.strictEqual(clickedHref, createdUrl);
        assert.strictEqual(clickedDownload, 'test-board.svg');

        // Crucial: URL must NOT be revoked synchronously on the main thread
        assert.strictEqual(revokeCalled, false, 'URL.revokeObjectURL must not be called synchronously');

        // After delayed timeout, revocation should occur
        await new Promise((resolve) => setTimeout(resolve, 1100));
        assert.strictEqual(revokeCalled, true, 'URL.revokeObjectURL must be called after download initiation');
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        (globalThis as unknown as { document: unknown }).document = originalDoc;
      }
    });
  });

  describe('3. PNG Blob Generation & Binary Signature Verification', () => {
    it('dataUrlToBlob creates binary Blob with image/png MIME type and valid PNG signature', async () => {
      // 1x1 transparent PNG data URL
      const validPngBase64 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const blob = dataUrlToBlob(validPngBase64, 'image/png');
      assert.strictEqual(blob.type, 'image/png', 'MIME type must be image/png');

      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      assert.strictEqual(uint8.length > 8, true);
      const signature = Array.from(uint8.subarray(0, 8));
      assert.deepStrictEqual(signature, PNG_SIGNATURE, 'PNG Blob must start with valid 8-byte PNG header');
    });
  });

  describe('4. Server PNG Export HTTP Error Verification', () => {
    it('rejects when server returns HTTP 403 error and does not save error JSON as image', async () => {
      const originalFetch = globalThis.fetch;

      // Mock fetch returning 403 Forbidden with JSON error message
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 403,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({ status: 'error', message: 'Access denied: not a member of this private room' }),
          blob: async () => new Blob([JSON.stringify({ status: 'error' })], { type: 'application/json' })
        } as unknown as Response;
      }) as typeof fetch;

      try {
        await assert.rejects(
          async () => {
            await downloadServerExportPng('priv-room-1', 'board.png');
          },
          (err: Error) => {
            assert.ok(err.message.includes('Access denied'), `Should report actual server error: ${err.message}`);
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('downloads valid binary PNG when server returns HTTP 200 with image/png', async () => {
      const originalFetch = globalThis.fetch;
      const originalDoc = (globalThis as unknown as { document?: unknown }).document;
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;

      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);

      let downloadedBlob: Blob | null = null;
      let downloadedFilename = '';

      URL.createObjectURL = (blob: Blob) => {
        downloadedBlob = blob;
        return 'blob:mock-server-png';
      };
      URL.revokeObjectURL = () => {};

      (globalThis as unknown as { document: unknown }).document = {
        createElement: () => ({
          href: '',
          download: '',
          click: function (this: { href: string; download: string }) {
            downloadedFilename = this.download;
          }
        }),
        body: { appendChild: () => {}, removeChild: () => {} }
      };

      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'image/png' }),
          blob: async () => new Blob([pngBytes], { type: 'image/png' })
        } as unknown as Response;
      }) as typeof fetch;

      try {
        await downloadServerExportPng('pub-room-1', 'exported-canvas');

        assert.ok(downloadedBlob, 'Must download a blob');
        assert.strictEqual(downloadedBlob!.type, 'image/png', 'MIME type must be image/png');
        assert.strictEqual(downloadedFilename, 'exported-canvas.png', 'Filename must end in .png');

        const arrayBuf = await downloadedBlob!.arrayBuffer();
        const first8 = Array.from(new Uint8Array(arrayBuf).subarray(0, 8));
        assert.deepStrictEqual(first8, PNG_SIGNATURE, 'Downloaded server blob must have PNG signature');
      } finally {
        globalThis.fetch = originalFetch;
        (globalThis as unknown as { document: unknown }).document = originalDoc;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
    });
  });

  describe('5. Filename Sanitization & Room Owner vs Joined User Parity', () => {
    it('sanitizeDownloadFilename handles illegal characters, empty names, and enforces extensions', () => {
      // Normal names
      assert.strictEqual(
        sanitizeDownloadFilename('BoardCollab-Test2-room-6e36dfcf', '.png'),
        'BoardCollab-Test2-room-6e36dfcf.png'
      );
      assert.strictEqual(
        sanitizeDownloadFilename('BoardCollab-Test2-room-6e36dfcf.png', '.png'),
        'BoardCollab-Test2-room-6e36dfcf.png'
      );

      // Raw UUID name (such as owner artifact 3412cbf5-8ef0-40b4-ab83-e5f2fe929a33)
      assert.strictEqual(
        sanitizeDownloadFilename('3412cbf5-8ef0-40b4-ab83-e5f2fe929a33', '.png'),
        '3412cbf5-8ef0-40b4-ab83-e5f2fe929a33.png'
      );

      // Filesystem illegal characters: / \ : * ? " < > |
      assert.strictEqual(
        sanitizeDownloadFilename('BoardCollab-Sprint 1 / Architecture: Alpha*-room-123', '.png'),
        'BoardCollab-Sprint 1 - Architecture- Alpha--room-123.png'
      );

      // Slashes and control chars
      assert.strictEqual(
        sanitizeDownloadFilename('BoardCollab-../secret/path-room-1', '.png'),
        'BoardCollab-..-secret-path-room-1.png'
      );

      // Empty or fallback strings
      assert.strictEqual(sanitizeDownloadFilename('', '.png'), 'BoardCollab-export.png');
      assert.strictEqual(sanitizeDownloadFilename('   ', '.svg'), 'BoardCollab-export.svg');
    });

    it('downloadBlob ensures both room owner and joined user always download files with valid .png extension', () => {
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const originalDoc = (globalThis as unknown as { document?: unknown }).document;

      let clickedDownload = '';

      URL.createObjectURL = () => 'blob:http://localhost:5173/3412cbf5-8ef0-40b4-ab83-e5f2fe929a33';
      URL.revokeObjectURL = () => {};

      (globalThis as unknown as { document: unknown }).document = {
        createElement: () => ({
          href: '',
          download: '',
          click: function (this: { href: string; download: string }) {
            clickedDownload = this.download;
          }
        }),
        body: { appendChild: () => {}, removeChild: () => {} }
      };

      try {
        const dummyBlob = new Blob([new Uint8Array(PNG_SIGNATURE)], { type: 'image/png' });

        // Joined user Ajay's download invocation
        downloadBlob(dummyBlob, 'BoardCollab-Test2-room-6e36dfcf');
        assert.strictEqual(
          clickedDownload,
          'BoardCollab-Test2-room-6e36dfcf.png',
          'Joined user download filename must have .png extension'
        );

        // Room owner's download invocation with raw UUID or custom name
        downloadBlob(dummyBlob, '3412cbf5-8ef0-40b4-ab83-e5f2fe929a33');
        assert.strictEqual(
          clickedDownload,
          '3412cbf5-8ef0-40b4-ab83-e5f2fe929a33.png',
          'Room owner UUID filename must be sanitized with .png extension'
        );

        // Room owner with complex board name containing slashes or quotes
        downloadBlob(dummyBlob, 'BoardCollab-Design/Architecture "Sprint 1"-room-d15187c5');
        assert.strictEqual(
          clickedDownload,
          'BoardCollab-Design-Architecture -Sprint 1--room-d15187c5.png',
          'Room owner board name with special characters must be safe and have .png'
        );
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        (globalThis as unknown as { document: unknown }).document = originalDoc;
      }
    });
  });
});
