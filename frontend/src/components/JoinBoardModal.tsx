import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomService } from '../services/room.service';
import { useAppDispatch, useAppSelector } from '../store/store';
import { addOrUpdateRoom } from '../store/room.slice';
import type { Room } from '../types/room.types';

interface JoinBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const JoinBoardModal: React.FC<JoinBoardModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);

  const [roomIdInput, setRoomIdInput] = useState<string>('');
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRoom, setPreviewRoom] = useState<Room | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setRoomIdInput('');
    setIsChecking(false);
    setIsJoining(false);
    setError(null);
    setPreviewRoom(null);
    onClose();
  };

  const handleCheckRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPreviewRoom(null);

    const trimmedId = roomIdInput.trim();
    if (!trimmedId) {
      setError('Please enter a valid Room ID');
      return;
    }

    setIsChecking(true);
    try {
      // Validate and retrieve room using existing GET /api/rooms/:id endpoint
      const room = await roomService.getRoom(trimmedId);
      setPreviewRoom(room);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to find or access board';
      setError(message);
    } finally {
      setIsChecking(false);
    }
  };

  const handleConfirmJoin = async () => {
    if (!previewRoom) return;

    setIsJoining(true);
    setError(null);

    try {
      const currentUserId = user?._id;
      const isOwner = currentUserId && (
        typeof previewRoom.owner === 'string'
          ? previewRoom.owner === currentUserId
          : previewRoom.owner?._id === currentUserId
      );
      const isAlreadyMember = currentUserId && Array.isArray(previewRoom.members) && previewRoom.members.some(
        (m) => (typeof m === 'string' ? m === currentUserId : m._id === currentUserId)
      );

      // If room is public and user is not yet an explicit member, use joinPublicRoom
      if (previewRoom.access === 'public' && !isAlreadyMember && !isOwner) {
        const joined = await roomService.joinPublicRoom(previewRoom.roomId);
        dispatch(addOrUpdateRoom(joined));
      } else {
        // Already a member/owner or authorized private room
        dispatch(addOrUpdateRoom(previewRoom));
      }

      handleClose();
      navigate(`/boards/${previewRoom.roomId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join board';
      setError(message);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose} role="dialog" aria-modal="true" aria-labelledby="join-board-title">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="join-board-title" className="modal-title">Join a Board</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="alert alert-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!previewRoom ? (
            <form onSubmit={handleCheckRoom} noValidate>
              <div className="form-group">
                <label htmlFor="join-room-id" className="form-label">
                  Room ID <span className="required-indicator">*</span>
                </label>
                <input
                  id="join-room-id"
                  type="text"
                  className={`form-input ${error ? 'has-error' : ''}`}
                  placeholder="e.g., room-a1b2c3d4 or custom ID"
                  value={roomIdInput}
                  onChange={(e) => {
                    setRoomIdInput(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={isChecking}
                  autoFocus
                />
                <p className="form-hint">
                  Ask the board owner or collaborator for their Room ID or paste the identifier from their share link.
                </p>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleClose}
                  disabled={isChecking}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isChecking || !roomIdInput.trim()}
                >
                  {isChecking ? (
                    <>
                      <span className="spinner" />
                      <span>Verifying Access...</span>
                    </>
                  ) : (
                    'Look Up Board'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="preview-room-container">
              <div className="alert alert-success">
                <span>✓ Board found and access verified!</span>
              </div>

              <div className="preview-room-card">
                <h3 className="preview-room-name">{previewRoom.name}</h3>
                <div className="preview-meta-grid">
                  <div className="meta-item">
                    <span className="meta-label">Room ID:</span>
                    <span className="meta-value font-mono">#{previewRoom.roomId}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Access Type:</span>
                    <span className={`badge ${previewRoom.access === 'private' ? 'badge-private' : 'badge-public'}`}>
                      {previewRoom.access === 'private' ? 'Private' : 'Public'}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Created By:</span>
                    <span className="meta-value">{previewRoom.owner?.name || 'Collaborator'}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Collaborators:</span>
                    <span className="meta-value">{previewRoom.members?.length || 1} members</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPreviewRoom(null)}
                  disabled={isJoining}
                >
                  Search Another
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirmJoin}
                  disabled={isJoining}
                >
                  {isJoining ? (
                    <>
                      <span className="spinner" />
                      <span>Joining...</span>
                    </>
                  ) : (
                    'Enter Board'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
