import { normalizeCanvasElement, type CanvasElement } from '../types/canvas.types.ts';

export interface RoomDraftPayload {
  roomId: string;
  savedAt: number;
  elementsCount: number;
  elements: CanvasElement[];
}

const STORAGE_PREFIX = 'boardcollab_draft_';

/**
 * Returns the room-specific localStorage key to prevent cross-board collision.
 */
export function getRoomDraftKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId.trim()}`;
}

/**
 * Safely checks if localStorage is accessible in current runtime.
 */
function isStorageAvailable(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  try {
    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Caches canvas elements for a specific room to localStorage.
 * Handles quota limits and storage errors gracefully without throwing.
 */
export function saveRoomDraft(roomId: string, elements: CanvasElement[]): boolean {
  if (!roomId || !Array.isArray(elements) || !isStorageAvailable()) {
    return false;
  }

  const key = getRoomDraftKey(roomId);
  const payload: RoomDraftPayload = {
    roomId: roomId.trim(),
    savedAt: Date.now(),
    elementsCount: elements.length,
    elements
  };

  try {
    const serialized = JSON.stringify(payload);
    window.localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.warn('[Draft Storage] Failed to save room draft to localStorage:', error);
    return false;
  }
}

/**
 * Safely loads and normalizes cached canvas elements for a specific room.
 * Returns null if no draft exists or if stored data is corrupted.
 */
export function loadRoomDraft(roomId: string): RoomDraftPayload | null {
  if (!roomId || !isStorageAvailable()) {
    return null;
  }

  const key = getRoomDraftKey(roomId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements)) {
      return null;
    }

    const normalizedElements = parsed.elements
      .map(normalizeCanvasElement)
      .filter((e: CanvasElement) => !e.isDeleted);

    return {
      roomId: typeof parsed.roomId === 'string' ? parsed.roomId : roomId,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
      elementsCount: normalizedElements.length,
      elements: normalizedElements
    };
  } catch (error) {
    console.warn('[Draft Storage] Malformed or corrupted draft JSON in localStorage:', error);
    return null;
  }
}

/**
 * Deletes the cached draft for a specific room.
 */
export function clearRoomDraft(roomId: string): boolean {
  if (!roomId || !isStorageAvailable()) {
    return false;
  }

  try {
    const key = getRoomDraftKey(roomId);
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether a valid draft with at least one element exists for the room.
 */
export function hasRoomDraft(roomId: string): boolean {
  const draft = loadRoomDraft(roomId);
  return Boolean(draft && draft.elements.length > 0);
}
