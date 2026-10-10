import { describe, it } from 'node:test';
import assert from 'node:assert';
import canvasReducer, {
  setElements,
  addElement,
  updateElement,
  deleteElement,
  type CanvasState
} from '../src/store/canvas.slice.ts';
import { HistoryManager } from '../src/utils/history.manager.ts';
import { normalizeCanvasElement, type RectangleElement } from '../src/types/canvas.types.ts';

describe('Frontend CRDT Integration Tests', () => {
  const rectElem: RectangleElement = {
    id: 'rect-1',
    elementId: 'rect-1',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    strokeColor: '#3b82f6',
    fillColor: '#93c5fd',
    strokeWidth: 2,
    version: 1,
    propertyClocks: {
      x: { clock: 1, updatedBy: 'user-1' },
      fillColor: { clock: 1, updatedBy: 'user-1' }
    }
  };

  it('1. Redux slice filters out isDeleted elements on setElements, addElement, and updateElement', () => {
    let state: CanvasState = { elements: [] };

    // Add active element
    state = canvasReducer(state, addElement(rectElem));
    assert.strictEqual(state.elements.length, 1);

    // Update with isDeleted: true should remove element from state
    const deletedElem = { ...rectElem, isDeleted: true };
    state = canvasReducer(state, updateElement(deletedElem));
    assert.strictEqual(state.elements.length, 0, 'Element with isDeleted: true must be removed from canvas');

    // setElements with mix of active and deleted elements
    state = canvasReducer(state, setElements([rectElem, deletedElem]));
    assert.strictEqual(state.elements.length, 1, 'setElements must filter out isDeleted elements');
    assert.strictEqual(state.elements[0].id, 'rect-1');
  });

  it('2. HistoryManager preserves unrelated local undo history when peer updates a different property', () => {
    const hm = new HistoryManager();

    // User locally updates position (x, y)
    hm.pushUpdate(
      'rect-1',
      { x: 10, y: 20 },
      { x: 50, y: 60 },
      1,
      2
    );
    assert.strictEqual(hm.canUndo(), true);

    // Peer updates fillColor (independent property)
    hm.handlePeerOperation('update', 'rect-1', ['fillColor']);
    assert.strictEqual(
      hm.canUndo(),
      true,
      'Local undo for (x, y) must be preserved when peer updates fillColor'
    );

    // Peer updates position x (conflicting property)
    hm.handlePeerOperation('update', 'rect-1', ['x']);
    assert.strictEqual(
      hm.canUndo(),
      false,
      'Local undo for (x, y) must be invalidated when peer modifies the same property x'
    );
  });

  it('3. normalizeCanvasElement preserves CRDT metadata (propertyClocks, clearEpoch)', () => {
    const raw = {
      id: 'rect-crdt-meta',
      type: 'rectangle',
      x: 30,
      y: 40,
      width: 90,
      height: 70,
      clearEpoch: 2,
      propertyClocks: {
        x: { clock: 5, updatedBy: 'user-alice' }
      }
    };

    const normalized = normalizeCanvasElement(raw);
    assert.strictEqual(normalized.clearEpoch, 2);
    assert.ok(normalized.propertyClocks);
    assert.strictEqual(normalized.propertyClocks.x.clock, 5);
    assert.strictEqual(normalized.propertyClocks.x.updatedBy, 'user-alice');
  });

  it('4. Explicit restoration allows re-adding previously deleted element to Redux state', () => {
    let state: CanvasState = { elements: [] };

    // Initially add
    state = canvasReducer(state, addElement(rectElem));
    assert.strictEqual(state.elements.length, 1);

    // Delete
    state = canvasReducer(state, deleteElement('rect-1'));
    assert.strictEqual(state.elements.length, 0);

    // Explicit restore: addElement with restored active element
    const restored = { ...rectElem, isDeleted: false, version: 2 };
    state = canvasReducer(state, addElement(restored));
    assert.strictEqual(state.elements.length, 1, 'Restored element must reappear on canvas');
    assert.strictEqual(state.elements[0].version, 2);
  });
});
