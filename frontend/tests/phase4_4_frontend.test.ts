import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  HistoryManager,
  type CreateHistoryEntry,
  type UpdateHistoryEntry,
  type DeleteHistoryEntry
} from '../src/utils/history.manager.ts';
import { escapeXml, calculateElementsBounds, serializeElementsToSvg } from '../src/utils/export.utils.ts';
import {
  normalizeCanvasElement,
  type CanvasElement,
  type StrokeElement,
  type RectangleElement,
  type CircleElement,
  type TextElement
} from '../src/types/canvas.types.ts';

describe('Phase 4.4 & 5.1: Frontend Whiteboard History, Normalization & Export Tests', () => {
  describe('1. HistoryManager (Undo/Redo & Peer Invalidation)', () => {
    it('initializes with empty undo and redo stacks', () => {
      const hm = new HistoryManager();
      assert.strictEqual(hm.canUndo(), false);
      assert.strictEqual(hm.canRedo(), false);
      assert.strictEqual(hm.getUndoCount(), 0);
      assert.strictEqual(hm.getRedoCount(), 0);
    });

    it('pushCreate enables undo and clears redo', () => {
      const hm = new HistoryManager();
      const mockElem: CanvasElement = { id: 'e1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50, version: 1 };

      hm.pushCreate(mockElem);
      assert.strictEqual(hm.canUndo(), true);
      assert.strictEqual(hm.canRedo(), false);
      assert.strictEqual(hm.getUndoCount(), 1);

      const popped = hm.popUndo() as CreateHistoryEntry | null;
      assert.strictEqual(popped?.type, 'create');
      assert.strictEqual(popped?.element.id, 'e1');
    });

    it('pushUpdate tracks before/after states and versions', () => {
      const hm = new HistoryManager();
      hm.pushUpdate('e2', { x: 10 }, { x: 50 }, 1, 2);

      assert.strictEqual(hm.canUndo(), true);
      const popped = hm.popUndo() as UpdateHistoryEntry | null;
      assert.strictEqual(popped?.type, 'update');
      assert.strictEqual(popped?.elementId, 'e2');
      assert.strictEqual(popped?.beforeVersion, 1);
      assert.strictEqual(popped?.afterVersion, 2);
    });

    it('pushDelete records deleted element for undo recreation', () => {
      const hm = new HistoryManager();
      const mockElem: CanvasElement = { id: 'e3', type: 'circle', x: 100, y: 100, radius: 25, version: 1 };
      hm.pushDelete(mockElem);

      assert.strictEqual(hm.canUndo(), true);
      const popped = hm.popUndo() as DeleteHistoryEntry | null;
      assert.strictEqual(popped?.type, 'delete');
      assert.strictEqual(popped?.element.id, 'e3');
    });

    it('invalidates stale history when peer deletes an element', () => {
      const hm = new HistoryManager();
      hm.pushUpdate('peer-elem', { x: 10 }, { x: 20 }, 1, 2);
      assert.strictEqual(hm.getUndoCount(), 1);

      // Peer deletes the element
      hm.handlePeerOperation('delete', 'peer-elem');
      // The update entry for peer-elem should be safely removed
      assert.strictEqual(hm.getUndoCount(), 0);
      assert.strictEqual(hm.canUndo(), false);
    });

    it('invalidates stale update history when peer updates an element', () => {
      const hm = new HistoryManager();
      hm.pushUpdate('elem-x', { width: 100 }, { width: 150 }, 1, 2);
      assert.strictEqual(hm.getUndoCount(), 1);

      // Peer updates elem-x concurrently
      hm.handlePeerOperation('update', 'elem-x');
      assert.strictEqual(hm.getUndoCount(), 0);
    });

    it('clears redo stack upon performing a new local action', () => {
      const hm = new HistoryManager();
      const e1: CanvasElement = { id: 'e1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 1 };
      const e2: CanvasElement = { id: 'e2', type: 'rectangle', x: 5, y: 5, width: 20, height: 20, version: 1 };

      hm.pushCreate(e1);
      const undone = hm.popUndo();
      assert.ok(undone);
      hm.pushToRedo(undone);
      assert.strictEqual(hm.canRedo(), true);

      // Perform a new local create action
      hm.pushCreate(e2);
      assert.strictEqual(hm.canRedo(), false);
    });

    it('enforces maximum history capacity limit', () => {
      const hm = new HistoryManager(3);
      for (let i = 1; i <= 5; i++) {
        hm.pushCreate({ id: `e${i}`, type: 'rectangle', x: i, y: i, width: 10, height: 10, version: 1 });
      }
      assert.strictEqual(hm.getUndoCount(), 3);
      const popped = hm.popUndo() as CreateHistoryEntry | null;
      assert.strictEqual(popped?.element.id, 'e5');
    });

    it('resets all stacks upon calling clear()', () => {
      const hm = new HistoryManager();
      hm.pushCreate({ id: 'e1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 1 });
      hm.clear();
      assert.strictEqual(hm.canUndo(), false);
      assert.strictEqual(hm.canRedo(), false);
    });
  });

  describe('2. Canvas Normalizer (normalizeCanvasElement)', () => {
    it('normalizes stroke with flat points array', () => {
      const raw = {
        elementId: 'stroke-1',
        type: 'stroke',
        points: [10, 20, 30, 40],
        strokeColor: '#ef4444',
        strokeWidth: 4
      };
      const normalized = normalizeCanvasElement(raw) as StrokeElement;
      assert.strictEqual(normalized.id, 'stroke-1');
      assert.strictEqual(normalized.type, 'stroke');
      assert.deepStrictEqual(normalized.points, [10, 20, 30, 40]);
      assert.strictEqual(normalized.strokeColor, '#ef4444');
      assert.strictEqual(normalized.strokeWidth, 4);
    });

    it('flattens stroke with array of point objects {x, y}', () => {
      const raw = {
        id: 'stroke-obj',
        type: 'stroke',
        points: [{ x: 5, y: 15 }, { x: 25, y: 35 }],
        version: 2
      };
      const normalized = normalizeCanvasElement(raw) as StrokeElement;
      assert.strictEqual(normalized.id, 'stroke-obj');
      assert.deepStrictEqual(normalized.points, [5, 15, 25, 35]);
      assert.strictEqual(normalized.version, 2);
    });

    it('normalizes rectangle with defaults and valid coordinates', () => {
      const raw = {
        id: 'rect-1',
        type: 'rectangle',
        x: 50,
        y: 60,
        width: 120,
        height: 80
      };
      const normalized = normalizeCanvasElement(raw) as RectangleElement;
      assert.strictEqual(normalized.type, 'rectangle');
      assert.strictEqual(normalized.width, 120);
      assert.strictEqual(normalized.height, 80);
      assert.strictEqual(normalized.version, 1);
    });

    it('normalizes circle and text elements properly', () => {
      const circleRaw = { id: 'c1', type: 'circle', x: 200, y: 200, radius: 45 };
      const circleNorm = normalizeCanvasElement(circleRaw) as CircleElement;
      assert.strictEqual(circleNorm.radius, 45);

      const textRaw = { id: 't1', type: 'text', x: 10, y: 20, text: 'Hello Collab' };
      const textNorm = normalizeCanvasElement(textRaw) as TextElement;
      assert.strictEqual(textNorm.text, 'Hello Collab');
      assert.strictEqual(textNorm.fontSize, 18);
    });
  });

  describe('3. Export Utilities (SVG Serialization & Safe Escaping)', () => {
    it('escapes XML characters to prevent injection / XSS', () => {
      const dangerous = '<script>alert("XSS") & \'test\'</script>';
      const escaped = escapeXml(dangerous);
      assert.strictEqual(escaped.includes('<script>'), false);
      assert.strictEqual(escaped.includes('&lt;script&gt;'), true);
      assert.strictEqual(escaped.includes('&quot;XSS&quot;'), true);
      assert.strictEqual(escaped.includes('&amp;'), true);
      assert.strictEqual(escaped.includes('&#39;test&#39;'), true);
    });

    it('calculates bounding box correctly for canvas elements', () => {
      const elements: CanvasElement[] = [
        { type: 'rectangle', x: 100, y: 100, width: 200, height: 150, version: 1, id: '1' },
        { type: 'circle', x: 500, y: 400, radius: 50, version: 1, id: '2' }
      ];

      const bounds = calculateElementsBounds(elements, 20);
      assert.strictEqual(bounds.minX, 80);
      assert.strictEqual(bounds.minY, 80);
      assert.strictEqual(bounds.maxX, 570);
      assert.strictEqual(bounds.maxY, 470);
      assert.strictEqual(bounds.width, 490);
      assert.strictEqual(bounds.height, 390);
    });

    it('serializes stroke, rectangle, circle, and text into valid SVG', () => {
      const elements: CanvasElement[] = [
        {
          id: 'stroke-1',
          type: 'stroke',
          points: [10, 20, 30, 40, 50, 60],
          strokeColor: '#f9fafb',
          strokeWidth: 3,
          version: 1
        },
        {
          id: 'rect-1',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 80,
          height: 60,
          strokeColor: '#6366f1',
          fillColor: 'transparent',
          strokeWidth: 2,
          version: 1
        },
        {
          id: 'circle-1',
          type: 'circle',
          x: 250,
          y: 250,
          radius: 40,
          strokeColor: '#10b981',
          fillColor: '#10b981',
          strokeWidth: 2,
          version: 1
        },
        {
          id: 'text-1',
          type: 'text',
          x: 300,
          y: 150,
          text: 'Architecture Plan <v1>',
          fontSize: 18,
          strokeColor: '#ffffff',
          version: 1
        }
      ];

      const svg = serializeElementsToSvg(elements);

      // Verify header and container
      assert.ok(svg.includes('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));

      // Verify stroke path
      assert.ok(svg.includes('<path d="M 10 20 L 30 40 L 50 60"'));
      assert.ok(svg.includes('stroke="#f9fafb"'));

      // Verify rectangle
      assert.ok(svg.includes('<rect x="100" y="100" width="80" height="60"'));
      assert.ok(svg.includes('stroke="#6366f1"'));

      // Verify circle
      assert.ok(svg.includes('<circle cx="250" cy="250" r="40"'));
      assert.ok(svg.includes('stroke="#10b981"'));

      // Verify text element with safe escaping
      assert.ok(svg.includes('<text x="300"'));
      assert.ok(svg.includes('Architecture Plan &lt;v1&gt;'));
      assert.strictEqual(svg.includes('<v1>'), false);
    });

    it('handles empty canvas gracefully with fallback placeholder', () => {
      const svg = serializeElementsToSvg([]);
      assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.ok(svg.includes('Empty Whiteboard'));
    });
  });
});
