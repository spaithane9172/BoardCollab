export type ToolType = 'select' | 'pen' | 'rectangle' | 'circle' | 'text';

export type CanvasElementType = 'stroke' | 'rectangle' | 'circle' | 'text';

export interface BaseCanvasElement {
  id: string;
  elementId?: string;
  type: CanvasElementType;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  opacity?: number;
  createdBy?: string;
  version: number;
  isDeleted?: boolean;
  clearEpoch?: number;
  propertyClocks?: Record<string, { clock: number; updatedBy: string }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface StrokeElement extends BaseCanvasElement {
  type: 'stroke';
  points: number[];
}

export interface RectangleElement extends BaseCanvasElement {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CircleElement extends BaseCanvasElement {
  type: 'circle';
  x: number;
  y: number;
  radius: number;
}

export interface TextElement extends BaseCanvasElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fontFamily?: string;
}

export type CanvasElement = StrokeElement | RectangleElement | CircleElement | TextElement;

export interface RoomParticipant {
  id: string;
  name: string;
  email: string;
}

export interface JoinRoomResponseData {
  room: {
    roomId: string;
    name: string;
    access: 'public' | 'private';
  };
  canvasState: CanvasElement[];
  participants: RoomParticipant[];
}

export interface CanvasOperationPayload {
  action: 'create' | 'update' | 'delete' | 'clear';
  element?: CanvasElement;
  elementId?: string;
  roomId?: string;
}

export interface SocketAckResponse<T = unknown> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  currentVersion?: number;
  expectedVersion?: number;
}

export function normalizeCanvasElement(raw: CanvasElement | Record<string, unknown>): CanvasElement {
  const r = raw as Record<string, unknown>;
  const id = String(r.id || r.elementId || '');
  const version = typeof r.version === 'number' ? r.version : 1;
  const type = String(r.type || '') as CanvasElementType;

  if (type === 'stroke') {
    let points: number[] = [];
    if (Array.isArray(r.points)) {
      if (r.points.length > 0 && typeof r.points[0] === 'object' && r.points[0] !== null) {
        const objPoints = r.points as Array<{ x?: number; y?: number }>;
        points = objPoints.flatMap((p) => [Number(p.x) || 0, Number(p.y) || 0]);
      } else {
        const numPoints = r.points as unknown[];
        points = numPoints.map((n) => Number(n) || 0);
      }
    }
    return {
      ...(r as unknown as StrokeElement),
      id,
      elementId: id,
      version,
      type: 'stroke',
      points,
      strokeColor: typeof r.strokeColor === 'string' ? r.strokeColor : '#f9fafb',
      strokeWidth: typeof r.strokeWidth === 'number' ? r.strokeWidth : 3,
      opacity: typeof r.opacity === 'number' ? r.opacity : 1
    };
  }

  if (type === 'rectangle') {
    return {
      ...(r as unknown as RectangleElement),
      id,
      elementId: id,
      version,
      type: 'rectangle',
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      strokeColor: typeof r.strokeColor === 'string' ? r.strokeColor : '#6366f1',
      fillColor: typeof r.fillColor === 'string' ? r.fillColor : 'transparent',
      strokeWidth: typeof r.strokeWidth === 'number' ? r.strokeWidth : 2,
      opacity: typeof r.opacity === 'number' ? r.opacity : 1
    };
  }

  if (type === 'circle') {
    return {
      ...(r as unknown as CircleElement),
      id,
      elementId: id,
      version,
      type: 'circle',
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      radius: Number(r.radius) || 0,
      strokeColor: typeof r.strokeColor === 'string' ? r.strokeColor : '#10b981',
      fillColor: typeof r.fillColor === 'string' ? r.fillColor : 'transparent',
      strokeWidth: typeof r.strokeWidth === 'number' ? r.strokeWidth : 2,
      opacity: typeof r.opacity === 'number' ? r.opacity : 1
    };
  }

  if (type === 'text') {
    return {
      ...(r as unknown as TextElement),
      id,
      elementId: id,
      version,
      type: 'text',
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      text: String(r.text || ''),
      fontSize: typeof r.fontSize === 'number' ? r.fontSize : 18,
      fontFamily: typeof r.fontFamily === 'string' ? r.fontFamily : 'Inter, sans-serif',
      strokeColor: typeof r.strokeColor === 'string' ? r.strokeColor : '#f9fafb',
      fillColor: typeof r.fillColor === 'string' ? r.fillColor : '#f9fafb',
      strokeWidth: typeof r.strokeWidth === 'number' ? r.strokeWidth : 1,
      opacity: typeof r.opacity === 'number' ? r.opacity : 1
    };
  }

  return {
    ...(r as unknown as CanvasElement),
    id,
    elementId: id,
    version
  };
}
