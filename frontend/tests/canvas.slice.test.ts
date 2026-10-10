import { describe, it } from 'node:test';
import assert from 'node:assert';
import canvasReducer, {
  setElements,
  addElement,
  updateElement,
  deleteElement,
  clearCanvas,
  type CanvasState
} from '../src/store/canvas.slice.ts';
import type { RectangleElement, CircleElement } from '../src/types/canvas.types.ts';

describe('Redux canvas.slice Tests', () => {
  const rectElem: RectangleElement = {
    id: 'elem-1',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    strokeColor: '#3b82f6',
    fillColor: '#93c5fd',
    strokeWidth: 2,
    version: 1
  };

  const circleElem: CircleElement = {
    id: 'elem-2',
    type: 'circle',
    x: 50,
    y: 50,
    radius: 30,
    strokeColor: '#ef4444',
    fillColor: 'transparent',
    strokeWidth: 3,
    version: 1
  };

  it('1. returns initial state with empty elements array', () => {
    const state = canvasReducer(undefined, { type: '@@INIT' });
    assert.deepStrictEqual(state, { elements: [] });
  });

  it('2. setElements replaces the current elements array', () => {
    const initialState: CanvasState = { elements: [rectElem] };
    const nextState = canvasReducer(initialState, setElements([circleElem]));
    assert.strictEqual(nextState.elements.length, 1);
    assert.strictEqual(nextState.elements[0].id, 'elem-2');
  });

  it('3. addElement appends a new element or updates if id already exists', () => {
    let state: CanvasState = { elements: [rectElem] };

    // Append new
    state = canvasReducer(state, addElement(circleElem));
    assert.strictEqual(state.elements.length, 2);
    assert.strictEqual(state.elements[1].id, 'elem-2');

    // Add with existing ID -> updates in place
    const updatedRect: RectangleElement = { ...rectElem, width: 250, version: 2 };
    state = canvasReducer(state, addElement(updatedRect));
    assert.strictEqual(state.elements.length, 2);
    assert.strictEqual((state.elements[0] as RectangleElement).width, 250);
    assert.strictEqual(state.elements[0].version, 2);
  });

  it('4. updateElement updates an existing element or appends if missing', () => {
    let state: CanvasState = { elements: [rectElem] };

    // Update existing
    const updated: RectangleElement = { ...rectElem, x: 99, version: 2 };
    state = canvasReducer(state, updateElement(updated));
    assert.strictEqual(state.elements.length, 1);
    assert.strictEqual(state.elements[0].x, 99);
    assert.strictEqual(state.elements[0].version, 2);

    // Update nonexistent element appends it
    state = canvasReducer(state, updateElement(circleElem));
    assert.strictEqual(state.elements.length, 2);
    assert.strictEqual(state.elements[1].id, 'elem-2');
  });

  it('5. deleteElement removes element by ID', () => {
    const state: CanvasState = { elements: [rectElem, circleElem] };
    const nextState = canvasReducer(state, deleteElement('elem-1'));
    assert.strictEqual(nextState.elements.length, 1);
    assert.strictEqual(nextState.elements[0].id, 'elem-2');

    // Deleting nonexistent ID leaves state unchanged
    const noopState = canvasReducer(nextState, deleteElement('nonexistent-id'));
    assert.strictEqual(noopState.elements.length, 1);
  });

  it('6. clearCanvas resets elements to empty array', () => {
    const state: CanvasState = { elements: [rectElem, circleElem] };
    const nextState = canvasReducer(state, clearCanvas());
    assert.deepStrictEqual(nextState.elements, []);
  });
});
