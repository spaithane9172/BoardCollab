import React from 'react';
import type { CanvasElement, ToolType } from '../types/canvas.types';

interface CanvasPropertiesBarProps {
  currentTool: ToolType;
  selectedElement: CanvasElement | null;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  onChangeStrokeColor: (color: string) => void;
  onChangeFillColor: (color: string) => void;
  onChangeStrokeWidth: (width: number) => void;
  onChangeFontSize: (size: number) => void;
}

const PRESET_STROKE_COLORS = [
  '#f9fafb', // White / Light
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#a855f7', // Purple
  '#06b6d4', // Cyan
  '#94a3b8'  // Slate
];

const PRESET_FILL_COLORS = [
  'transparent',
  '#111827',
  'rgba(99, 102, 241, 0.25)',
  'rgba(16, 185, 129, 0.25)',
  'rgba(245, 158, 11, 0.25)',
  'rgba(239, 68, 68, 0.25)'
];

const STROKE_WIDTHS = [1, 2, 4, 8];
const FONT_SIZES = [14, 18, 24, 32, 48];

export const CanvasPropertiesBar: React.FC<CanvasPropertiesBarProps> = ({
  currentTool,
  selectedElement,
  strokeColor,
  fillColor,
  strokeWidth,
  fontSize,
  onChangeStrokeColor,
  onChangeFillColor,
  onChangeStrokeWidth,
  onChangeFontSize
}) => {
  const isTextMode = currentTool === 'text' || selectedElement?.type === 'text';
  const showFill = currentTool === 'rectangle' || currentTool === 'circle' || (selectedElement && (selectedElement.type === 'rectangle' || selectedElement.type === 'circle'));

  return (
    <div className="canvas-props-bar" role="toolbar" aria-label="Canvas element styling">
      {/* Selected Element / Tool Status */}
      <div className="props-section status-section">
        {selectedElement ? (
          <div className="selected-tag">
            <span className="capitalize font-semibold">{selectedElement.type}</span>
            <span className="version-pill">v{selectedElement.version}</span>
          </div>
        ) : (
          <div className="tool-indicator">
            <span className="meta-label">Active:</span>
            <span className="capitalize">{currentTool}</span>
          </div>
        )}
      </div>

      <div className="props-divider" />

      {/* Stroke Color */}
      <div className="props-section">
        <span className="prop-label">Stroke:</span>
        <div className="color-palette">
          {PRESET_STROKE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${strokeColor === c ? 'active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => onChangeStrokeColor(c)}
              aria-label={`Stroke color ${c}`}
            />
          ))}
          <input
            type="color"
            value={strokeColor.startsWith('#') ? strokeColor : '#f9fafb'}
            onChange={(e) => onChangeStrokeColor(e.target.value)}
            className="custom-color-picker"
            title="Custom stroke color"
            aria-label="Custom stroke color"
          />
        </div>
      </div>

      {/* Fill Color */}
      {showFill && (
        <>
          <div className="props-divider" />
          <div className="props-section">
            <span className="prop-label">Fill:</span>
            <div className="color-palette">
              {PRESET_FILL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${fillColor === c ? 'active' : ''} ${c === 'transparent' ? 'swatch-transparent' : ''}`}
                  style={{ backgroundColor: c === 'transparent' ? 'transparent' : c }}
                  onClick={() => onChangeFillColor(c)}
                  aria-label={`Fill color ${c}`}
                  title={c === 'transparent' ? 'Transparent' : c}
                >
                  {c === 'transparent' && <span className="transparent-cross" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="props-divider" />

      {/* Stroke Width */}
      <div className="props-section">
        <span className="prop-label">Width:</span>
        <div className="width-selector">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={`width-btn ${strokeWidth === w ? 'active' : ''}`}
              onClick={() => onChangeStrokeWidth(w)}
              aria-label={`Stroke width ${w}px`}
            >
              <span className="width-preview" style={{ height: `${w}px` }} />
              <span className="width-label">{w}px</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Size (if Text tool or text element selected) */}
      {isTextMode && (
        <>
          <div className="props-divider" />
          <div className="props-section">
            <span className="prop-label">Size:</span>
            <div className="size-selector">
              {FONT_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`size-btn ${fontSize === s ? 'active' : ''}`}
                  onClick={() => onChangeFontSize(s)}
                  aria-label={`Font size ${s}px`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
