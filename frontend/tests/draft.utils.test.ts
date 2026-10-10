import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  getRoomDraftKey,
  saveRoomDraft,
  loadRoomDraft,
  clearRoomDraft,
  hasRoomDraft
} from '../src/utils/draft.utils.ts';
import canvasReducer, { setElements, type CanvasState } from '../src/store/canvas.slice.ts';
import type { RectangleElement, CircleElement } from '../src/types/canvas.types.ts';

// In-memory mock storage implementation for Node runtime
class MockStorage implements Storage {
  private store: Map<string, string> = new Map();
  public shouldThrowOnSet: boolean = false;
  public shouldThrowOnGet: boolean = false;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    if (this.shouldThrowOnGet) {
      throw new Error('Storage read failure');
    }
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrowOnSet) {
      throw new Error('QuotaExceededError: DOM Exception 22');
    }
    this.store.set(key, String(value));
  }
}

const mockStorage = new MockStorage();

interface GlobalWithWindow {
  window?: {
    localStorage: Storage;
  };
}

const customGlobal = globalThis as unknown as GlobalWithWindow;

// Ensure window and localStorage exist in Node test environment
if (typeof customGlobal.window === 'undefined') {
  customGlobal.window = {
    localStorage: mockStorage
  };
} else {
  customGlobal.window.localStorage = mockStorage;
}

describe('Offline Draft Recovery & Local Storage Tests', () => {
  const sampleRect: RectangleElement = {
    id: 'rect-alpha',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 120,
    height: 80,
    strokeColor: '#6366f1',
    fillColor: '#c7d2fe',
    strokeWidth: 2,
    version: 1
  };

  const sampleCircle: CircleElement = {
    id: 'circle-beta',
    type: 'circle',
    x: 150,
    y: 100,
    radius: 40,
    strokeColor: '#ef4444',
    fillColor: 'transparent',
    strokeWidth: 3,
    version: 1
  };

  beforeEach(() => {
    mockStorage.clear();
    mockStorage.shouldThrowOnSet = false;
    mockStorage.shouldThrowOnGet = false;
  });

  it('1. generates isolated, room-specific storage keys to prevent collisions', () => {
    const keyA = getRoomDraftKey('room-alpha');
    const keyB = getRoomDraftKey('room-beta');
    const keyTrimmed = getRoomDraftKey('  room-alpha  ');

    assert.strictEqual(keyA, 'boardcollab_draft_room-alpha');
    assert.strictEqual(keyB, 'boardcollab_draft_room-beta');
    assert.strictEqual(keyTrimmed, keyA);
    assert.notStrictEqual(keyA, keyB);
  });

  it('2. saves and loads room drafts safely with metadata', () => {
    const roomId = 'room-101';
    const elements = [sampleRect, sampleCircle];

    const saved = saveRoomDraft(roomId, elements);
    assert.strictEqual(saved, true);

    const loaded = loadRoomDraft(roomId);
    assert.ok(loaded);
    assert.strictEqual(loaded.roomId, roomId);
    assert.strictEqual(loaded.elementsCount, 2);
    assert.strictEqual(loaded.elements.length, 2);
    assert.strictEqual(loaded.elements[0].id, 'rect-alpha');
    assert.strictEqual(loaded.elements[1].id, 'circle-beta');
    assert.strictEqual(typeof loaded.savedAt, 'number');
  });

  it('3. isolates drafts between different rooms', () => {
    saveRoomDraft('room-a', [sampleRect]);
    saveRoomDraft('room-b', [sampleCircle]);

    const draftA = loadRoomDraft('room-a');
    const draftB = loadRoomDraft('room-b');

    assert.ok(draftA);
    assert.ok(draftB);
    assert.strictEqual(draftA.elements.length, 1);
    assert.strictEqual(draftA.elements[0].id, 'rect-alpha');
    assert.strictEqual(draftB.elements.length, 1);
    assert.strictEqual(draftB.elements[0].id, 'circle-beta');

    // Clearing room-a does not affect room-b
    clearRoomDraft('room-a');
    assert.strictEqual(loadRoomDraft('room-a'), null);
    assert.ok(loadRoomDraft('room-b'));
  });

  it('4. safely handles malformed, corrupted, or non-array draft JSON', () => {
    const key = getRoomDraftKey('corrupt-room');

    // Malformed JSON string
    mockStorage.setItem(key, '{not-valid-json---');
    assert.strictEqual(loadRoomDraft('corrupt-room'), null);

    // Non-object JSON
    mockStorage.setItem(key, '"some-string"');
    assert.strictEqual(loadRoomDraft('corrupt-room'), null);

    // Missing elements array
    mockStorage.setItem(key, JSON.stringify({ roomId: 'corrupt-room', savedAt: 123 }));
    assert.strictEqual(loadRoomDraft('corrupt-room'), null);

    // Elements is not an array
    mockStorage.setItem(key, JSON.stringify({ roomId: 'corrupt-room', elements: 'not-array' }));
    assert.strictEqual(loadRoomDraft('corrupt-room'), null);
  });

  it('5. handles quota errors and storage exceptions gracefully without crashing', () => {
    mockStorage.shouldThrowOnSet = true;
    const saveResult = saveRoomDraft('quota-room', [sampleRect]);
    assert.strictEqual(saveResult, false);

    mockStorage.shouldThrowOnSet = false;
    saveRoomDraft('read-error-room', [sampleRect]);

    mockStorage.shouldThrowOnGet = true;
    const loadResult = loadRoomDraft('read-error-room');
    assert.strictEqual(loadResult, null);
  });

  it('6. hasRoomDraft correctly identifies valid drafts with content', () => {
    assert.strictEqual(hasRoomDraft('empty-room'), false);

    saveRoomDraft('empty-room', []);
    assert.strictEqual(hasRoomDraft('empty-room'), false);

    saveRoomDraft('active-room', [sampleRect]);
    assert.strictEqual(hasRoomDraft('active-room'), true);
  });

  it('7. safely recovers cached draft into Redux canvas elements state', () => {
    const roomId = 'restore-test-room';
    saveRoomDraft(roomId, [sampleRect, sampleCircle]);

    const cachedDraft = loadRoomDraft(roomId);
    assert.ok(cachedDraft);

    // Initial state is empty (e.g. server unavailable or fresh connect)
    const initialReduxState: CanvasState = { elements: [] };

    // Recovery action: setElements with draft elements
    const recoveredReduxState = canvasReducer(
      initialReduxState,
      setElements(cachedDraft.elements)
    );

    assert.strictEqual(recoveredReduxState.elements.length, 2);
    assert.strictEqual(recoveredReduxState.elements[0].id, 'rect-alpha');
    assert.strictEqual(recoveredReduxState.elements[1].id, 'circle-beta');
  });
});
