import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { CanvasElement, ToolType, StrokeElement, RectangleElement, CircleElement, TextElement } from '../types/canvas.types';
import { exportStageToPng } from '../utils/export.utils';

export interface CanvasWorkspaceHandle {
  exportPng: (filename: string) => Promise<void>;
  getStage: () => Konva.Stage | null;
}

interface CanvasWorkspaceProps {
  elements: CanvasElement[];
  currentTool: ToolType;
  selectedId: string | null;
  onSelectElement: (id: string | null) => void;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  isPanning: boolean;
  onDrawElement: (element: Partial<CanvasElement> & { id: string; type: CanvasElement['type'] }) => void;
  onUpdateElement: (id: string, changes: Record<string, unknown>, expectedVersion: number) => void;
}

export const CanvasWorkspace = forwardRef<CanvasWorkspaceHandle, CanvasWorkspaceProps>(({
  elements,
  currentTool,
  selectedId,
  onSelectElement,
  strokeColor,
  fillColor,
  strokeWidth,
  fontSize,
  isPanning,
  onDrawElement,
  onUpdateElement
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  // Expose exportPng and getStage via imperative handle
  useImperativeHandle(ref, () => ({
    exportPng: async (filename: string) => {
      const stage = stageRef.current;
      if (!stage) return;

      // Temporarily detach transformer so selection boxes/handles are excluded from PNG
      const prevNodes = transformerRef.current?.nodes() || [];
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }

      try {
        await exportStageToPng(stage, filename);
      } finally {
        if (transformerRef.current && prevNodes.length > 0) {
          transformerRef.current.nodes(prevNodes);
          transformerRef.current.getLayer()?.batchDraw();
        }
      }
    },
    getStage: () => stageRef.current
  }));

  // Dimensions
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: window.innerWidth,
    height: window.innerHeight - 120
  });

  // Local drawing state
  const isDrawingRef = useRef<boolean>(false);
  const [previewElement, setPreviewElement] = useState<CanvasElement | null>(null);

  // Text Prompt Dialog state
  const [textPromptPos, setTextPromptPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState<string>('');

  // Auto-resize Stage to container
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth || window.innerWidth,
          height: containerRef.current.offsetHeight || window.innerHeight - 120
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Sync Konva Transformer to selected node
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;

    if (!selectedId || currentTool !== 'select' || isPanning) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    const selectedNode = stageRef.current.findOne(`#${selectedId}`);
    if (selectedNode) {
      transformerRef.current.nodes([selectedNode]);
      transformerRef.current.getLayer()?.batchDraw();
    } else {
      transformerRef.current.nodes([]);
    }
  }, [selectedId, currentTool, elements, isPanning]);

  // Stage pointer coordinate helper
  const getPointerPos = () => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return transform.point(pos);
  };

  // Generate unique client element ID
  const generateElementId = () => {
    return `elem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  };

  // Mouse Down
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (isPanning) return;

    // Deselect if clicking on empty stage with select tool
    if (currentTool === 'select') {
      const clickedOnEmpty = e.target === stageRef.current;
      if (clickedOnEmpty) {
        onSelectElement(null);
      }
      return;
    }

    const pos = getPointerPos();
    isDrawingRef.current = true;

    if (currentTool === 'pen') {
      setPreviewElement({
        id: 'preview',
        type: 'stroke',
        points: [Math.round(pos.x), Math.round(pos.y)],
        strokeColor,
        strokeWidth,
        opacity: 1,
        version: 1
      });
    } else if (currentTool === 'rectangle') {
      setPreviewElement({
        id: 'preview',
        type: 'rectangle',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: 0,
        height: 0,
        strokeColor,
        fillColor,
        strokeWidth,
        opacity: 1,
        version: 1
      });
    } else if (currentTool === 'circle') {
      setPreviewElement({
        id: 'preview',
        type: 'circle',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        radius: 0,
        strokeColor,
        fillColor,
        strokeWidth,
        opacity: 1,
        version: 1
      });
    } else if (currentTool === 'text') {
      isDrawingRef.current = false;
      setTextPromptPos({ x: Math.round(pos.x), y: Math.round(pos.y) });
      setTextInputValue('');
    }
  };

  // Mouse Move
  const handleMouseMove = () => {
    if (!isDrawingRef.current || !previewElement || isPanning) return;
    const pos = getPointerPos();

    if (previewElement.type === 'stroke') {
      const strokeElem = previewElement as StrokeElement;
      setPreviewElement({
        ...strokeElem,
        points: [...strokeElem.points, Math.round(pos.x), Math.round(pos.y)]
      });
    } else if (previewElement.type === 'rectangle') {
      const rectElem = previewElement as RectangleElement;
      const startX = rectElem.x;
      const startY = rectElem.y;
      const width = Math.abs(Math.round(pos.x) - startX);
      const height = Math.abs(Math.round(pos.y) - startY);
      const x = Math.min(startX, Math.round(pos.x));
      const y = Math.min(startY, Math.round(pos.y));
      setPreviewElement({
        ...rectElem,
        x,
        y,
        width,
        height
      });
    } else if (previewElement.type === 'circle') {
      const circleElem = previewElement as CircleElement;
      const startX = circleElem.x;
      const startY = circleElem.y;
      const radius = Math.round(Math.sqrt((pos.x - startX) ** 2 + (pos.y - startY) ** 2));
      setPreviewElement({
        ...circleElem,
        radius
      });
    }
  };

  // Mouse Up
  const handleMouseUp = () => {
    if (!isDrawingRef.current || !previewElement || isPanning) {
      isDrawingRef.current = false;
      setPreviewElement(null);
      return;
    }

    isDrawingRef.current = false;
    const newId = generateElementId();

    if (previewElement.type === 'stroke') {
      const stroke = previewElement as StrokeElement;
      if (stroke.points.length >= 4) {
        onDrawElement({
          id: newId,
          type: 'stroke',
          points: stroke.points,
          strokeColor: stroke.strokeColor,
          strokeWidth: stroke.strokeWidth,
          opacity: stroke.opacity
        });
      }
    } else if (previewElement.type === 'rectangle') {
      const rect = previewElement as RectangleElement;
      if (rect.width > 3 && rect.height > 3) {
        onDrawElement({
          id: newId,
          type: 'rectangle',
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          strokeColor: rect.strokeColor,
          fillColor: rect.fillColor,
          strokeWidth: rect.strokeWidth,
          opacity: rect.opacity
        });
      }
    } else if (previewElement.type === 'circle') {
      const circle = previewElement as CircleElement;
      if (circle.radius > 3) {
        onDrawElement({
          id: newId,
          type: 'circle',
          x: circle.x,
          y: circle.y,
          radius: circle.radius,
          strokeColor: circle.strokeColor,
          fillColor: circle.fillColor,
          strokeWidth: circle.strokeWidth,
          opacity: circle.opacity
        });
      }
    }

    setPreviewElement(null);
  };

  // Submit Text Dialog
  const handleConfirmText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textPromptPos) return;

    const trimmed = textInputValue.trim();
    if (trimmed) {
      const newId = generateElementId();
      onDrawElement({
        id: newId,
        type: 'text',
        x: textPromptPos.x,
        y: textPromptPos.y,
        text: trimmed,
        fontSize,
        strokeColor,
        fillColor: strokeColor,
        strokeWidth: 1,
        opacity: 1
      });
    }

    setTextPromptPos(null);
    setTextInputValue('');
  };

  // Element Drag End
  const handleElementDragEnd = useCallback(
    (element: CanvasElement, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const newX = Math.round(node.x());
      const newY = Math.round(node.y());

      if (element.type === 'stroke') {
        const stroke = element as StrokeElement;
        const dx = newX;
        const dy = newY;
        // Offset all points by dx, dy and reset node position
        const updatedPoints = stroke.points.map((val, idx) => (idx % 2 === 0 ? val + dx : val + dy));
        node.position({ x: 0, y: 0 });

        onUpdateElement(
          element.id,
          {
            points: updatedPoints
          },
          element.version
        );
      } else {
        onUpdateElement(
          element.id,
          {
            x: newX,
            y: newY
          },
          element.version
        );
      }
    },
    [onUpdateElement]
  );

  // Element Transform End (Resizing with Transformer)
  const handleElementTransformEnd = useCallback(
    (element: CanvasElement, e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      node.scaleX(1);
      node.scaleY(1);

      if (element.type === 'rectangle') {
        const width = Math.max(5, Math.round(node.width() * scaleX));
        const height = Math.max(5, Math.round(node.height() * scaleY));
        const x = Math.round(node.x());
        const y = Math.round(node.y());

        onUpdateElement(
          element.id,
          {
            x,
            y,
            width,
            height
          },
          element.version
        );
      } else if (element.type === 'circle') {
        const circleNode = node as Konva.Circle;
        const scale = Math.max(scaleX, scaleY);
        const radius = Math.max(5, Math.round(circleNode.radius() * scale));
        const x = Math.round(node.x());
        const y = Math.round(node.y());

        onUpdateElement(
          element.id,
          {
            x,
            y,
            radius
          },
          element.version
        );
      } else if (element.type === 'text') {
        const textNode = node as Konva.Text;
        const scale = Math.max(scaleX, scaleY);
        const newFontSize = Math.max(8, Math.min(200, Math.round((textNode.fontSize() || 18) * scale)));
        const x = Math.round(node.x());
        const y = Math.round(node.y());

        onUpdateElement(
          element.id,
          {
            x,
            y,
            fontSize: newFontSize
          },
          element.version
        );
      }
    },
    [onUpdateElement]
  );

  return (
    <div className={`canvas-workspace-container ${isPanning ? 'panning-cursor' : ''}`} ref={containerRef}>
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        draggable={isPanning}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      >
        <Layer>
          {/* Confirmed Authoritative Elements */}
          {elements.map((el) => {
            const isSelected = el.id === selectedId;
            const isDraggable = currentTool === 'select' && isSelected && !isPanning;

            if (el.type === 'stroke') {
              const stroke = el as StrokeElement;
              return (
                <Line
                  key={stroke.id}
                  id={stroke.id}
                  points={stroke.points}
                  stroke={stroke.strokeColor || '#f9fafb'}
                  strokeWidth={stroke.strokeWidth || 3}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  opacity={stroke.opacity ?? 1}
                  draggable={isDraggable}
                  onClick={() => currentTool === 'select' && onSelectElement(stroke.id)}
                  onTap={() => currentTool === 'select' && onSelectElement(stroke.id)}
                  onDragEnd={(e) => handleElementDragEnd(stroke, e)}
                />
              );
            }

            if (el.type === 'rectangle') {
              const rect = el as RectangleElement;
              return (
                <Rect
                  key={rect.id}
                  id={rect.id}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  stroke={rect.strokeColor || '#6366f1'}
                  strokeWidth={rect.strokeWidth || 2}
                  fill={rect.fillColor && rect.fillColor !== 'transparent' ? rect.fillColor : undefined}
                  cornerRadius={4}
                  opacity={rect.opacity ?? 1}
                  draggable={isDraggable}
                  onClick={() => currentTool === 'select' && onSelectElement(rect.id)}
                  onTap={() => currentTool === 'select' && onSelectElement(rect.id)}
                  onDragEnd={(e) => handleElementDragEnd(rect, e)}
                  onTransformEnd={(e) => handleElementTransformEnd(rect, e)}
                />
              );
            }

            if (el.type === 'circle') {
              const circle = el as CircleElement;
              return (
                <Circle
                  key={circle.id}
                  id={circle.id}
                  x={circle.x}
                  y={circle.y}
                  radius={circle.radius}
                  stroke={circle.strokeColor || '#10b981'}
                  strokeWidth={circle.strokeWidth || 2}
                  fill={circle.fillColor && circle.fillColor !== 'transparent' ? circle.fillColor : undefined}
                  opacity={circle.opacity ?? 1}
                  draggable={isDraggable}
                  onClick={() => currentTool === 'select' && onSelectElement(circle.id)}
                  onTap={() => currentTool === 'select' && onSelectElement(circle.id)}
                  onDragEnd={(e) => handleElementDragEnd(circle, e)}
                  onTransformEnd={(e) => handleElementTransformEnd(circle, e)}
                />
              );
            }

            if (el.type === 'text') {
              const text = el as TextElement;
              return (
                <Text
                  key={text.id}
                  id={text.id}
                  x={text.x}
                  y={text.y}
                  text={text.text}
                  fontSize={text.fontSize || 18}
                  fontFamily={text.fontFamily || 'Inter, sans-serif'}
                  fill={text.strokeColor || text.fillColor || '#f9fafb'}
                  opacity={text.opacity ?? 1}
                  draggable={isDraggable}
                  onClick={() => currentTool === 'select' && onSelectElement(text.id)}
                  onTap={() => currentTool === 'select' && onSelectElement(text.id)}
                  onDragEnd={(e) => handleElementDragEnd(text, e)}
                  onTransformEnd={(e) => handleElementTransformEnd(text, e)}
                />
              );
            }

            return null;
          })}

          {/* Active Local Preview */}
          {previewElement && (
            <>
              {previewElement.type === 'stroke' && (
                <Line
                  points={(previewElement as StrokeElement).points}
                  stroke={previewElement.strokeColor}
                  strokeWidth={previewElement.strokeWidth}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  dash={[4, 4]}
                />
              )}
              {previewElement.type === 'rectangle' && (
                <Rect
                  x={(previewElement as RectangleElement).x}
                  y={(previewElement as RectangleElement).y}
                  width={(previewElement as RectangleElement).width}
                  height={(previewElement as RectangleElement).height}
                  stroke={previewElement.strokeColor}
                  strokeWidth={previewElement.strokeWidth}
                  fill={previewElement.fillColor}
                  dash={[6, 4]}
                  cornerRadius={4}
                />
              )}
              {previewElement.type === 'circle' && (
                <Circle
                  x={(previewElement as CircleElement).x}
                  y={(previewElement as CircleElement).y}
                  radius={(previewElement as CircleElement).radius}
                  stroke={previewElement.strokeColor}
                  strokeWidth={previewElement.strokeWidth}
                  fill={previewElement.fillColor}
                  dash={[6, 4]}
                />
              )}
            </>
          )}

          {/* Konva Transformer for resizing/rotating selected elements */}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox;
              }
              return newBox;
            }}
          />
        </Layer>
      </Stage>

      {/* Inline Text Prompt Modal */}
      {textPromptPos && (
        <div className="text-prompt-overlay" onClick={() => setTextPromptPos(null)}>
          <div className="text-prompt-box" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-prompt-title">Add Text to Board</h4>
            <form onSubmit={handleConfirmText}>
              <textarea
                className="form-input text-prompt-input"
                placeholder="Type your text note or label..."
                value={textInputValue}
                onChange={(e) => setTextInputValue(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="text-prompt-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setTextPromptPos(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!textInputValue.trim()}
                >
                  Place Text
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});

CanvasWorkspace.displayName = 'CanvasWorkspace';
