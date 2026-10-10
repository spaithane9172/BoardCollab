import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/store';
import {
  setElements as setCanvasElements,
  addElement as addCanvasElement,
  updateElement as updateCanvasElement,
  deleteElement as deleteCanvasElement,
  clearCanvas as clearCanvasAction
} from '../store/canvas.slice';
import { roomService } from '../services/room.service';
import { socketService } from '../services/socket.service';
import { ApiError } from '../services/api.client';
import { CanvasToolbar } from '../components/CanvasToolbar';
import { CanvasPropertiesBar } from '../components/CanvasPropertiesBar';
import { CanvasWorkspace, type CanvasWorkspaceHandle } from '../components/CanvasWorkspace';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { HistoryManager } from '../utils/history.manager';
import { serializeElementsToSvg, downloadSvg, downloadServerExportPng } from '../utils/export.utils';
import {
  saveRoomDraft,
  loadRoomDraft,
  clearRoomDraft,
  type RoomDraftPayload
} from '../utils/draft.utils';
import {
  normalizeCanvasElement,
  type CanvasElement,
  type ToolType,
  type RoomParticipant,
  type CanvasOperationPayload,
  type SocketAckResponse,
  type JoinRoomResponseData
} from '../types/canvas.types';
import { InviteCollaboratorModal } from '../components/InviteCollaboratorModal';
import { addOrUpdateRoom } from '../store/room.slice';
import type { Room } from '../types/room.types';

export const BoardPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const dispatch = useAppDispatch();
  const { token, user } = useAppSelector((state) => state.auth);
  const elements = useAppSelector((state) => state.canvas.elements);

  // Room verification and authorization state
  const [room, setRoom] = useState<Room | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState<boolean>(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  // Network & Collaborative state
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isConnected, setIsConnected] = useState<boolean>(socketService.isConnected());
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [draftAvailable, setDraftAvailable] = useState<RoomDraftPayload | null>(() => {
    return roomId ? loadRoomDraft(roomId) : null;
  });
  const [isDraftBannerDismissed, setIsDraftBannerDismissed] = useState<boolean>(false);
  const [prevRoomId, setPrevRoomId] = useState<string | undefined>(roomId);

  // Synchronize draft state when roomId changes (official React pattern: adjusting state during render)
  if (roomId !== prevRoomId) {
    setPrevRoomId(roomId);
    setDraftAvailable(roomId ? loadRoomDraft(roomId) : null);
    setIsDraftBannerDismissed(false);
  }

  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isRosterOpen, setIsRosterOpen] = useState<boolean>(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState<boolean>(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);

  // Authoritative owner check based on authenticated user ID and room owner ID
  const isOwner = Boolean(
    user?._id &&
    room &&
    (typeof room.owner === 'string'
      ? room.owner === user._id
      : room.owner?._id === user._id)
  );

  // Tool & selection state
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState<boolean>(false);

  // Active styling properties
  const [strokeColor, setStrokeColor] = useState<string>('#6366f1');
  const [fillColor, setFillColor] = useState<string>('transparent');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(18);

  const selectedElement = elements.find((e) => e.id === selectedId) || null;

  // History & Workspace refs
  const historyRef = useRef<HistoryManager>(new HistoryManager(50));
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const workspaceRef = useRef<CanvasWorkspaceHandle>(null);
  const isJoiningRef = useRef<boolean>(false);

  const syncHistoryState = useCallback(() => {
    setCanUndo(historyRef.current.canUndo());
    setCanRedo(historyRef.current.canRedo());
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3000);
  }, []);

  // Online / Offline Connectivity Listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Internet connection restored');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('You are currently offline. Local changes will be cached.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  // Auto-save room draft when Redux elements change
  useEffect(() => {
    if (!roomId) return;
    if (elements.length > 0) {
      saveRoomDraft(roomId, elements);
    }
  }, [roomId, elements]);

  // Draft Recovery Handler
  const handleRecoverDraft = useCallback(() => {
    if (!draftAvailable || draftAvailable.elements.length === 0) return;
    dispatch(setCanvasElements(draftAvailable.elements));
    setIsDraftBannerDismissed(true);
    showToast(`Restored local draft (${draftAvailable.elements.length} elements)`);
  }, [draftAvailable, dispatch, showToast]);

  // 1. Initial Room Verification via REST API
  useEffect(() => {
    let isMounted = true;
    if (!roomId) return;

    roomService
      .getRoom(roomId)
      .then((roomData) => {
        if (!isMounted) return;
        setRoom(roomData);
        setAccessDeniedMessage(null);
        setIsLoadingRoom(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const isNetworkFailure =
          (err instanceof ApiError && err.statusCode === 0) ||
          (typeof navigator !== 'undefined' && !navigator.onLine);

        if (isNetworkFailure) {
          // Server or network is unavailable, provide offline room to allow viewing and draft recovery
          setRoom({
            _id: roomId,
            roomId: roomId,
            name: `Board #${roomId}`,
            access: 'private',
            owner: { _id: '', name: 'Local User', email: '' },
            members: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          setAccessDeniedMessage(null);
        } else {
          const message = err instanceof Error ? err.message : 'Unable to access board';
          setAccessDeniedMessage(message);
        }
        setIsLoadingRoom(false);
      });

    return () => {
      isMounted = false;
    };
  }, [roomId]);

  // Join Room via Socket.IO
  const joinSocketRoom = useCallback(
    (targetRoomId: string) => {
      const socket = socketService.getSocket();
      if (!socket || !socket.connected || isJoiningRef.current) return;

      isJoiningRef.current = true;
      socket.emit('join-room', targetRoomId, (ack?: SocketAckResponse<JoinRoomResponseData>) => {
        isJoiningRef.current = false;
        if (ack?.status === 'success' && ack.data) {
          setIsJoined(true);
          const rawElements = (ack.data.canvasState || []) as unknown as Array<Record<string, unknown>>;
          dispatch(setCanvasElements(rawElements.map(normalizeCanvasElement)));
          setParticipants(ack.data.participants || []);
        } else {
          setAccessDeniedMessage(ack?.message || 'Access denied by server');
        }
      });
    },
    [dispatch]
  );

  // 2. Socket.IO Room Lifecycle & Event Listeners
  useEffect(() => {
    if (!token || !roomId || accessDeniedMessage) return;

    const socket = socketService.getSocket() || socketService.connect(token);

    const unsubscribeConn = socketService.onConnectionChange((connected) => {
      setIsConnected(connected);
      if (connected) {
        joinSocketRoom(roomId);
        showToast('Connected to collaboration gateway');
      } else {
        showToast('Connection lost. Reconnecting...');
      }
    });

    if (socket.connected) {
      joinSocketRoom(roomId);
    }

    // Handler: Peer canvas operations (DO NOT push to local user's history!)
    const handleCanvasOperation = (payload: CanvasOperationPayload) => {
      if (!payload || !payload.action) return;

      if (payload.action === 'create' && payload.element) {
        const normalized = normalizeCanvasElement(payload.element);
        dispatch(addCanvasElement(normalized));
        historyRef.current.handlePeerOperation('create', normalized.id);
        syncHistoryState();
      } else if (payload.action === 'update' && payload.element) {
        const normalized = normalizeCanvasElement(payload.element);
        dispatch(updateCanvasElement(normalized));
        // Invalidate stale local history only for the specific properties updated by peer
        const updatedProps = payload.element.propertyClocks ? Object.keys(payload.element.propertyClocks) : undefined;
        historyRef.current.handlePeerOperation('update', normalized.id, updatedProps);
        syncHistoryState();
      } else if (payload.action === 'delete' && payload.elementId) {
        const targetId = payload.elementId;
        dispatch(deleteCanvasElement(targetId));
        setSelectedId((curr) => (curr === targetId ? null : curr));
        historyRef.current.handlePeerOperation('delete', targetId);
        syncHistoryState();
      } else if (payload.action === 'clear') {
        dispatch(clearCanvasAction());
        setSelectedId(null);
        historyRef.current.clear();
        syncHistoryState();
        if (roomId) clearRoomDraft(roomId);
        setDraftAvailable(null);
        showToast('Canvas was cleared by a collaborator');
      }
    };

    // Handler: Peer presence
    const handleUserJoined = (data: { user: RoomParticipant }) => {
      if (data?.user) {
        setParticipants((prev) => {
          if (prev.some((p) => p.id === data.user.id)) return prev;
          return [...prev, data.user];
        });
        showToast(`${data.user.name || 'A collaborator'} joined the board`);
      }
    };

    const handleUserLeft = (data: { user: RoomParticipant }) => {
      if (data?.user) {
        setParticipants((prev) => prev.filter((p) => p.id !== data.user.id));
        showToast(`${data.user.name || 'A collaborator'} left the board`);
      }
    };

    const handleReconnect = () => {
      joinSocketRoom(roomId);
    };

    socket.on('canvas-operation', handleCanvasOperation);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('connect', handleReconnect);

    return () => {
      unsubscribeConn();
      socket.off('canvas-operation', handleCanvasOperation);
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
      socket.off('connect', handleReconnect);
      setIsJoined(false);
    };
  }, [dispatch, token, roomId, accessDeniedMessage, joinSocketRoom, syncHistoryState, showToast]);

  // 3. Local Canvas Operations
  const handleDrawElement = useCallback(
    (newElementData: Partial<CanvasElement> & { id: string; type: CanvasElement['type'] }) => {
      const socket = socketService.getSocket();
      if (!socket || !isJoined) return;

      socket.emit('draw-element', newElementData, (ack?: SocketAckResponse<Record<string, unknown>>) => {
        if (ack?.status === 'success' && ack.data) {
          const authoritative = normalizeCanvasElement(ack.data);
          dispatch(addCanvasElement(authoritative));
          // Push to user undo history
          historyRef.current.pushCreate(authoritative);
          syncHistoryState();
        } else {
          setConflictNotice(ack?.message || 'Failed to add element to whiteboard');
        }
      });
    },
    [dispatch, isJoined, syncHistoryState]
  );

  const handleUpdateElement = useCallback(
    (elementId: string, changes: Record<string, unknown>, expectedVersion: number) => {
      const socket = socketService.getSocket();
      if (!socket || !isJoined) return;

      const beforeElement = elements.find((e) => e.id === elementId);
      const beforeChanges: Record<string, unknown> = {};
      if (beforeElement) {
        const record = beforeElement as unknown as Record<string, unknown>;
        Object.keys(changes).forEach((key) => {
          beforeChanges[key] = record[key];
        });
      }

      socket.emit(
        'update-element',
        {
          id: elementId,
          elementId,
          changes,
          expectedVersion,
          propertyClocks: beforeElement?.propertyClocks
        },
        (ack?: SocketAckResponse<Record<string, unknown>>) => {
          if (ack?.status === 'success' && ack.data) {
            const authoritative = normalizeCanvasElement(ack.data);
            dispatch(updateCanvasElement(authoritative));
            // Push to user undo history
            historyRef.current.pushUpdate(
              elementId,
              beforeChanges,
              changes,
              expectedVersion,
              authoritative.version
            );
            syncHistoryState();
          } else if (ack?.status === 'error') {
            setConflictNotice(ack.message || 'Failed to update element');
          }
        }
      );
    },
    [dispatch, isJoined, elements, syncHistoryState]
  );

  const handleDeleteElement = useCallback(
    (elementId: string) => {
      const socket = socketService.getSocket();
      if (!socket || !isJoined) return;

      const elementToDelete = elements.find((e) => e.id === elementId);

      socket.emit('delete-element', elementId, (ack?: SocketAckResponse<{ id: string }>) => {
        if (ack?.status === 'success') {
          dispatch(deleteCanvasElement(elementId));
          setSelectedId(null);
          if (elementToDelete) {
            historyRef.current.pushDelete(elementToDelete);
            syncHistoryState();
          }
        } else {
          setConflictNotice(ack?.message || 'Failed to delete element');
        }
      });
    },
    [dispatch, isJoined, elements, syncHistoryState]
  );

  const handleConfirmClearCanvas = useCallback(() => {
    const socket = socketService.getSocket();
    if (!socket || !isJoined) return;

    socket.emit('clear-canvas', (ack?: SocketAckResponse) => {
      setIsClearModalOpen(false);
      if (ack?.status === 'success') {
        dispatch(clearCanvasAction());
        setSelectedId(null);
        historyRef.current.clear();
        syncHistoryState();
        if (roomId) clearRoomDraft(roomId);
        setDraftAvailable(null);
        showToast('Canvas cleared successfully');
      } else {
        showToast(ack?.message || 'Failed to clear canvas');
      }
    });
  }, [dispatch, isJoined, syncHistoryState, roomId, showToast]);

  // 4. Undo & Redo Handlers
  const handleUndo = useCallback(() => {
    const socket = socketService.getSocket();
    if (!socket || !isJoined || !historyRef.current.canUndo()) return;

    const entry = historyRef.current.popUndo();
    if (!entry) return;

    if (entry.type === 'create') {
      // Undo create: delete element
      socket.emit('delete-element', entry.element.id, (ack?: SocketAckResponse<{ id: string }>) => {
        if (ack?.status === 'success') {
          dispatch(deleteCanvasElement(entry.element.id));
          setSelectedId((curr) => (curr === entry.element.id ? null : curr));
          historyRef.current.pushToRedo(entry);
          syncHistoryState();
        } else {
          setConflictNotice('Cannot undo: Element was already removed or modified');
          syncHistoryState();
        }
      });
    } else if (entry.type === 'update') {
      // Undo update: restore before state using current version as expectedVersion
      const current = elements.find((e) => e.id === entry.elementId);
      if (!current) {
        setConflictNotice('Cannot undo: Target element no longer exists');
        syncHistoryState();
        return;
      }

      socket.emit(
        'update-element',
        {
          id: entry.elementId,
          elementId: entry.elementId,
          changes: entry.before,
          expectedVersion: current.version
        },
        (ack?: SocketAckResponse<Record<string, unknown>>) => {
          if (ack?.status === 'success' && ack.data) {
            const authoritative = normalizeCanvasElement(ack.data);
            dispatch(updateCanvasElement(authoritative));
            historyRef.current.pushToRedo(entry);
            syncHistoryState();
          } else {
            setConflictNotice(
              `Cannot undo: ${ack?.message || 'Element was modified by a collaborator'}`
            );
            if (roomId) joinSocketRoom(roomId);
            syncHistoryState();
          }
        }
      );
    } else if (entry.type === 'delete') {
      // Undo delete: re-create element with explicit restore flag
      socket.emit('draw-element', { ...entry.element, restore: true }, (ack?: SocketAckResponse<Record<string, unknown>>) => {
        if (ack?.status === 'success' && ack.data) {
          const authoritative = normalizeCanvasElement(ack.data);
          dispatch(addCanvasElement(authoritative));
          historyRef.current.pushToRedo(entry);
          syncHistoryState();
        } else {
          setConflictNotice('Cannot undo: Unable to restore deleted element');
          syncHistoryState();
        }
      });
    }
  }, [dispatch, isJoined, elements, roomId, joinSocketRoom, syncHistoryState]);

  const handleRedo = useCallback(() => {
    const socket = socketService.getSocket();
    if (!socket || !isJoined || !historyRef.current.canRedo()) return;

    const entry = historyRef.current.popRedo();
    if (!entry) return;

    if (entry.type === 'create') {
      // Redo create: re-draw element
      socket.emit('draw-element', entry.element, (ack?: SocketAckResponse<Record<string, unknown>>) => {
        if (ack?.status === 'success' && ack.data) {
          const authoritative = normalizeCanvasElement(ack.data);
          dispatch(addCanvasElement(authoritative));
          historyRef.current.pushToUndo(entry);
          syncHistoryState();
        } else {
          setConflictNotice('Cannot redo creation: Element ID collision or error');
          syncHistoryState();
        }
      });
    } else if (entry.type === 'update') {
      // Redo update: re-apply after state
      const current = elements.find((e) => e.id === entry.elementId);
      if (!current) {
        setConflictNotice('Cannot redo: Target element no longer exists');
        syncHistoryState();
        return;
      }

      socket.emit(
        'update-element',
        {
          id: entry.elementId,
          elementId: entry.elementId,
          changes: entry.after,
          expectedVersion: current.version
        },
        (ack?: SocketAckResponse<Record<string, unknown>>) => {
          if (ack?.status === 'success' && ack.data) {
            const authoritative = normalizeCanvasElement(ack.data);
            dispatch(updateCanvasElement(authoritative));
            historyRef.current.pushToUndo(entry);
            syncHistoryState();
          } else {
            setConflictNotice(
              `Cannot redo: ${ack?.message || 'Element was modified by a collaborator'}`
            );
            if (roomId) joinSocketRoom(roomId);
            syncHistoryState();
          }
        }
      );
    } else if (entry.type === 'delete') {
      // Redo delete: delete element again
      socket.emit('delete-element', entry.element.id, (ack?: SocketAckResponse<{ id: string }>) => {
        if (ack?.status === 'success') {
          dispatch(deleteCanvasElement(entry.element.id));
          setSelectedId((curr) => (curr === entry.element.id ? null : curr));
          historyRef.current.pushToUndo(entry);
          syncHistoryState();
        } else {
          setConflictNotice('Cannot redo delete: Element already removed');
          syncHistoryState();
        }
      });
    }
  }, [dispatch, isJoined, elements, roomId, joinSocketRoom, syncHistoryState]);

  // 5. Export Actions
  const handleExportPng = useCallback(async () => {
    if (!room) return;
    try {
      showToast('Exporting high-resolution PNG image...');
      if (workspaceRef.current) {
        await workspaceRef.current.exportPng(`BoardCollab-${room.name}-${room.roomId}`);
      } else {
        await downloadServerExportPng(room.roomId, `BoardCollab-${room.name}-${room.roomId}.png`);
      }
      showToast('✓ PNG downloaded successfully');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export canvas as PNG image';
      setConflictNotice(msg);
    }
  }, [room, showToast]);

  const handleExportSvg = useCallback(() => {
    if (!room) return;
    try {
      showToast('Serializing vector SVG elements...');
      const svg = serializeElementsToSvg(elements);
      downloadSvg(svg, `BoardCollab-${room.name}-${room.roomId}.svg`);
      showToast('✓ Vector SVG downloaded successfully');
    } catch {
      setConflictNotice('Failed to export canvas as vector SVG');
    }
  }, [room, elements, showToast]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')
      ) {
        return;
      }

      // Undo / Redo keyboard shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Delete & Tools
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        handleDeleteElement(selectedId);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (e.key === 'v' || e.key === 'V') {
        setCurrentTool('select');
        setIsPanning(false);
      } else if (e.key === 'p' || e.key === 'P') {
        setCurrentTool('pen');
        setIsPanning(false);
      } else if (e.key === 'r' || e.key === 'R') {
        setCurrentTool('rectangle');
        setIsPanning(false);
      } else if (e.key === 'c' || e.key === 'C') {
        setCurrentTool('circle');
        setIsPanning(false);
      } else if (e.key === 't' || e.key === 'T') {
        setCurrentTool('text');
        setIsPanning(false);
      } else if (e.key === 'h' || e.key === 'H') {
        setIsPanning((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, handleDeleteElement, handleUndo, handleRedo]);

  // Copy Share Link
  const handleCopyShareLink = async () => {
    const shareUrl = `${window.location.origin}/boards/${roomId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(false);
    }
  };

  // Property Change Handlers
  const handleChangeStrokeColor = (color: string) => {
    setStrokeColor(color);
    if (selectedElement) {
      handleUpdateElement(selectedElement.id, { strokeColor: color }, selectedElement.version);
    }
  };

  const handleChangeFillColor = (color: string) => {
    setFillColor(color);
    if (selectedElement && (selectedElement.type === 'rectangle' || selectedElement.type === 'circle')) {
      handleUpdateElement(selectedElement.id, { fillColor: color }, selectedElement.version);
    }
  };

  const handleChangeStrokeWidth = (width: number) => {
    setStrokeWidth(width);
    if (selectedElement) {
      handleUpdateElement(selectedElement.id, { strokeWidth: width }, selectedElement.version);
    }
  };

  const handleChangeFontSize = (size: number) => {
    setFontSize(size);
    if (selectedElement && selectedElement.type === 'text') {
      handleUpdateElement(selectedElement.id, { fontSize: size }, selectedElement.version);
    }
  };

  // Loading Screen
  if (isLoadingRoom) {
    return (
      <div className="board-loading-screen">
        <LoadingSpinner message="Verifying room access..." />
      </div>
    );
  }

  // Access Denied or Room Not Found
  if (accessDeniedMessage || !room) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
        <div className="auth-card" style={{ maxWidth: '520px', margin: '0 auto' }}>
          <div className="empty-icon-wrap" style={{ color: 'var(--danger)', marginBottom: '1.5rem' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 style={{ marginBottom: '0.75rem' }}>Access Denied</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            {accessDeniedMessage || 'You do not have permission to access this whiteboard or the room does not exist.'}
          </p>
          <Link to="/dashboard" className="btn btn-primary btn-block">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="whiteboard-page">
      {/* 1. Top Navigation & Header Bar */}
      <header className="board-topbar">
        <div className="topbar-left">
          <Link to="/dashboard" className="btn btn-outline btn-sm" title="Back to Dashboard">
            &larr; Dashboard
          </Link>
          <div className="board-info-block">
            <h1 className="board-name-title" title={room.name}>
              {room.name}
            </h1>
            <span className="room-id-tag">#{room.roomId}</span>
            <span className={`badge ${room.access === 'private' ? 'badge-private' : 'badge-public'}`}>
              {room.access === 'private' ? 'Private' : 'Public'}
            </span>
          </div>
        </div>

        <div className="topbar-right">
          {/* Real-time Socket & Offline status indicator */}
          {!isOnline ? (
            <span
              className="socket-status-pill offline"
              title="Browser is offline. Local drafts are cached."
              aria-label="Offline status"
            >
              <span className="status-dot" />
              Offline
            </span>
          ) : !isConnected ? (
            <span
              className="socket-status-pill disconnected"
              title="Disconnected from server. Reconnecting..."
              aria-label="Disconnected status"
            >
              <span className="status-dot" />
              Disconnected
            </span>
          ) : !isJoined ? (
            <span
              className="socket-status-pill joining"
              title="Joining room..."
              aria-label="Joining room status"
            >
              <span className="status-dot" />
              Joining...
            </span>
          ) : (
            <span
              className="socket-status-pill connected"
              title="Connected to collaborative gateway"
              aria-label="Live connected status"
            >
              <span className="status-dot" />
              Live
            </span>
          )}

          {/* Invite Collaborator - visible strictly to room owner of private board */}
          {room.access === 'private' && isOwner && (
            <button
              type="button"
              className="btn btn-primary btn-sm invite-collaborator-btn"
              onClick={() => setIsInviteModalOpen(true)}
              title="Invite collaborator to private board"
              aria-label="Invite Collaborator"
              id="invite-collaborator-btn"
              data-testid="invite-collaborator-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ marginRight: '0.35rem', verticalAlign: 'middle' }}
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Invite Collaborator
            </button>
          )}

          {/* Active Participants Roster Toggle */}
          <button
            type="button"
            className="participants-pill participants-btn"
            onClick={() => setIsRosterOpen((prev) => !prev)}
            title="Click to view online participants"
            aria-label="View online participants"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{participants.length} online</span>
          </button>

          {/* Share Link */}
          <button
            type="button"
            className={`btn btn-secondary btn-sm copy-btn ${copiedLink ? 'copied' : ''}`}
            onClick={handleCopyShareLink}
            title="Copy share link for collaborators"
          >
            {copiedLink ? '✓ Copied' : 'Share'}
          </button>
        </div>
      </header>

      {/* Draft Recovery Banner */}
      {draftAvailable && draftAvailable.elements.length > 0 && !isDraftBannerDismissed && (
        <aside className="draft-recovery-banner" role="region" aria-label="Local Draft Recovery">
          <div className="draft-banner-info">
            <span className="draft-banner-badge">Local Draft Available</span>
            <span>
              A cached draft with {draftAvailable.elements.length} element{draftAvailable.elements.length === 1 ? '' : 's'}{' '}
              (saved {new Date(draftAvailable.savedAt).toLocaleTimeString()}) is available on this device.
            </span>
          </div>
          <div className="draft-banner-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleRecoverDraft}
              aria-label="Restore Local Draft"
            >
              Restore Local Draft
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setIsDraftBannerDismissed(true)}
              aria-label="Dismiss Draft Notice"
            >
              Dismiss
            </button>
          </div>
        </aside>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="toast-notification" role="status">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Version Conflict Notice Banner */}
      {conflictNotice && (
        <div className="conflict-banner alert alert-error" role="alert">
          <span>{conflictNotice}</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setConflictNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Participants Roster Modal */}
      {isRosterOpen && (
        <div className="roster-modal-backdrop" onClick={() => setIsRosterOpen(false)}>
          <div className="roster-card" onClick={(e) => e.stopPropagation()}>
            <div className="roster-header">
              <h3>Collaborators in Room ({participants.length})</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsRosterOpen(false)}
                aria-label="Close roster"
              >
                &times;
              </button>
            </div>
            <div className="roster-list">
              {participants.map((p) => (
                <div key={p.id} className="roster-item">
                  <div className="user-avatar">{p.name ? p.name.charAt(0).toUpperCase() : 'U'}</div>
                  <div className="roster-user-info">
                    <span className="roster-name">{p.name || 'Anonymous User'}</span>
                    <span className="roster-email">{p.email || 'online'}</span>
                  </div>
                  <span className="roster-badge">Active</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Clear Canvas Confirmation Modal */}
      {isClearModalOpen && (
        <div className="roster-modal-backdrop" onClick={() => setIsClearModalOpen(false)}>
          <div className="roster-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="roster-header">
              <h3 style={{ color: 'var(--danger)' }}>Clear Whiteboard Canvas?</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsClearModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>
            <div style={{ padding: '1rem 0' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                Are you sure you want to clear all elements from this whiteboard? This action will remove all drawings for all collaborators in this room and cannot be undone.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsClearModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleConfirmClearCanvas}
              >
                Yes, Clear Canvas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Collaborator Modal */}
      {room && (
        <InviteCollaboratorModal
          isOpen={isInviteModalOpen}
          onClose={() => setIsInviteModalOpen(false)}
          room={room}
          onMemberAdded={(updatedRoom) => {
            setRoom(updatedRoom);
            dispatch(addOrUpdateRoom(updatedRoom));
            showToast('✓ Collaborator added successfully');
          }}
        />
      )}

      {/* Main Workspace Area: Toolbar + Canvas + Properties */}
      <div className="whiteboard-body">
        <CanvasToolbar
          currentTool={currentTool}
          onSelectTool={(tool) => {
            setCurrentTool(tool);
            setIsPanning(false);
          }}
          hasSelection={Boolean(selectedId)}
          onDeleteSelected={() => selectedId && handleDeleteElement(selectedId)}
          isPanning={isPanning}
          onTogglePanning={() => setIsPanning((prev) => !prev)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onExportPng={handleExportPng}
          onExportSvg={handleExportSvg}
          onClearCanvas={() => setIsClearModalOpen(true)}
        />

        <main className="canvas-main-area">
          <CanvasPropertiesBar
            currentTool={currentTool}
            selectedElement={selectedElement}
            strokeColor={strokeColor}
            fillColor={fillColor}
            strokeWidth={strokeWidth}
            fontSize={fontSize}
            onChangeStrokeColor={handleChangeStrokeColor}
            onChangeFillColor={handleChangeFillColor}
            onChangeStrokeWidth={handleChangeStrokeWidth}
            onChangeFontSize={handleChangeFontSize}
          />

          <CanvasWorkspace
            ref={workspaceRef}
            elements={elements}
            currentTool={currentTool}
            selectedId={selectedId}
            onSelectElement={setSelectedId}
            strokeColor={strokeColor}
            fillColor={fillColor}
            strokeWidth={strokeWidth}
            fontSize={fontSize}
            isPanning={isPanning}
            onDrawElement={handleDrawElement}
            onUpdateElement={handleUpdateElement}
          />
        </main>
      </div>
    </div>
  );
};
