import type { CanvasElement } from '../types/canvas.types';

export type HistoryActionType = 'create' | 'update' | 'delete';

export interface CreateHistoryEntry {
  type: 'create';
  element: CanvasElement;
}

export interface UpdateHistoryEntry {
  type: 'update';
  elementId: string;
  before: Partial<CanvasElement>;
  after: Partial<CanvasElement>;
  beforeVersion: number;
  afterVersion: number;
}

export interface DeleteHistoryEntry {
  type: 'delete';
  element: CanvasElement;
}

export type HistoryEntry = CreateHistoryEntry | UpdateHistoryEntry | DeleteHistoryEntry;

export class HistoryManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistory: number = 50;

  constructor(maxHistory = 50) {
    this.maxHistory = maxHistory;
  }

  /**
   * Pushes a locally created element onto the undo stack and clears redo stack.
   */
  pushCreate(element: CanvasElement): void {
    this.undoStack.push({ type: 'create', element });
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Pushes a locally updated element changes onto the undo stack and clears redo stack.
   */
  pushUpdate(
    elementId: string,
    before: Partial<CanvasElement>,
    after: Partial<CanvasElement>,
    beforeVersion: number,
    afterVersion: number
  ): void {
    this.undoStack.push({
      type: 'update',
      elementId,
      before,
      after,
      beforeVersion,
      afterVersion
    });
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Pushes a locally deleted element onto the undo stack and clears redo stack.
   */
  pushDelete(element: CanvasElement): void {
    this.undoStack.push({ type: 'delete', element });
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  popUndo(): HistoryEntry | null {
    return this.undoStack.pop() || null;
  }

  pushToRedo(entry: HistoryEntry): void {
    this.redoStack.push(entry);
    if (this.redoStack.length > this.maxHistory) this.redoStack.shift();
  }

  popRedo(): HistoryEntry | null {
    return this.redoStack.pop() || null;
  }

  pushToUndo(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
  }

  /**
   * Invalidate history entries safely when an element is modified or deleted by another collaborator.
   * If updatedProperties is provided, only entries touching the same properties are invalidated.
   */
  handlePeerOperation(
    action: 'create' | 'update' | 'delete',
    elementId: string,
    updatedProperties?: string[]
  ): void {
    if (action === 'delete') {
      // If peer deleted the element, local user cannot undo/redo updates of it
      this.undoStack = this.undoStack.filter((entry) => {
        if (entry.type === 'update' && entry.elementId === elementId) return false;
        if (entry.type === 'delete' && entry.element.id === elementId) return false;
        return true;
      });
      this.redoStack = this.redoStack.filter((entry) => {
        if (entry.type === 'update' && entry.elementId === elementId) return false;
        if (entry.type === 'create' && entry.element.id === elementId) return false;
        return true;
      });
    } else if (action === 'update') {
      // Invalidate local update history entries only if peer modified the SAME properties,
      // preserving unrelated local undo entries (e.g. peer changed color, local user moved position).
      const hasConflict = (entry: UpdateHistoryEntry) => {
        if (entry.elementId !== elementId) return false;
        if (!updatedProperties || updatedProperties.length === 0) return true;
        const localProps = Object.keys(entry.after);
        return localProps.some((p) => updatedProperties.includes(p));
      };

      this.undoStack = this.undoStack.filter((entry) => {
        if (entry.type === 'update' && hasConflict(entry)) return false;
        return true;
      });
      this.redoStack = this.redoStack.filter((entry) => {
        if (entry.type === 'update' && hasConflict(entry)) return false;
        return true;
      });
    }
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getUndoCount(): number {
    return this.undoStack.length;
  }

  getRedoCount(): number {
    return this.redoStack.length;
  }
}
