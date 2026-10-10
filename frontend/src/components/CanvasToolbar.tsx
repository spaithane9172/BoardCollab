import React from 'react';
import type { ToolType } from '../types/canvas.types';

interface CanvasToolbarProps {
  currentTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  isPanning: boolean;
  onTogglePanning: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onClearCanvas?: () => void;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  currentTool,
  onSelectTool,
  hasSelection,
  onDeleteSelected,
  isPanning,
  onTogglePanning,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExportPng,
  onExportSvg,
  onClearCanvas
}) => {
  return (
    <aside className="canvas-toolbar" aria-label="Whiteboard drawing tools">
      {/* Undo & Redo */}
      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo action"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
          </svg>
          <span className="tooltip">Undo (Ctrl+Z)</span>
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          aria-label="Redo action"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
          </svg>
          <span className="tooltip">Redo (Ctrl+Y)</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Select & Pan */}
      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn ${currentTool === 'select' && !isPanning ? 'active' : ''}`}
          onClick={() => onSelectTool('select')}
          title="Select & Move (V)"
          aria-label="Select tool"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l7 18 3-7 7-3L3 3z" />
          </svg>
          <span className="tooltip">Select (V)</span>
        </button>

        <button
          type="button"
          className={`toolbar-btn ${isPanning ? 'active' : ''}`}
          onClick={onTogglePanning}
          title="Pan Workspace (H or Space+Drag)"
          aria-label="Pan tool"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3M14 9V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8M6 14v1a7 7 0 0 0 7 7h1a7 7 0 0 0 7-7v-3a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2" />
          </svg>
          <span className="tooltip">Pan (H)</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Drawing Tools */}
      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn ${currentTool === 'pen' && !isPanning ? 'active' : ''}`}
          onClick={() => onSelectTool('pen')}
          title="Freehand Pen (P)"
          aria-label="Pen tool"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
          <span className="tooltip">Pen (P)</span>
        </button>

        <button
          type="button"
          className={`toolbar-btn ${currentTool === 'rectangle' && !isPanning ? 'active' : ''}`}
          onClick={() => onSelectTool('rectangle')}
          title="Rectangle (R)"
          aria-label="Rectangle tool"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          <span className="tooltip">Rectangle (R)</span>
        </button>

        <button
          type="button"
          className={`toolbar-btn ${currentTool === 'circle' && !isPanning ? 'active' : ''}`}
          onClick={() => onSelectTool('circle')}
          title="Circle (C)"
          aria-label="Circle tool"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
          </svg>
          <span className="tooltip">Circle (C)</span>
        </button>

        <button
          type="button"
          className={`toolbar-btn ${currentTool === 'text' && !isPanning ? 'active' : ''}`}
          onClick={() => onSelectTool('text')}
          title="Text Note (T)"
          aria-label="Text tool"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
          <span className="tooltip">Text (T)</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Delete Action */}
      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn btn-danger-action"
          onClick={onDeleteSelected}
          disabled={!hasSelection}
          title="Delete Selected (Del/Backspace)"
          aria-label="Delete selected element"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span className="tooltip">Delete (Del)</span>
        </button>

        {onClearCanvas && (
          <button
            type="button"
            className="toolbar-btn btn-danger-action"
            onClick={onClearCanvas}
            title="Clear Entire Canvas"
            aria-label="Clear entire canvas"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span className="tooltip">Clear Canvas</span>
          </button>
        )}
      </div>

      <div className="toolbar-divider" />

      {/* Export Options */}
      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          onClick={onExportPng}
          title="Export as PNG Image"
          aria-label="Export PNG"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span className="tooltip">Export PNG</span>
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onExportSvg}
          title="Export as Vector SVG"
          aria-label="Export SVG"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span className="tooltip">Export SVG</span>
        </button>
      </div>
    </aside>
  );
};
