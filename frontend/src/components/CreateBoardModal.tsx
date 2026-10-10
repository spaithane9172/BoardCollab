import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/store';
import { createRoom, clearCreateError } from '../store/room.slice';
import type { Room } from '../types/room.types';

interface CreateBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateBoardModal: React.FC<CreateBoardModalProps> = ({ isOpen, onClose }) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isCreating, createError } = useAppSelector((state) => state.rooms);

  const [name, setName] = useState<string>('');
  const [access, setAccess] = useState<'public' | 'private'>('public');
  const [clientError, setClientError] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<Room | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setName('');
    setAccess('public');
    setClientError(null);
    setCreatedRoom(null);
    dispatch(clearCreateError());
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setClientError('Board name is required');
      return;
    }
    if (trimmedName.length > 100) {
      setClientError('Board name cannot exceed 100 characters');
      return;
    }

    try {
      const resultAction = await dispatch(
        createRoom({
          name: trimmedName,
          access
        })
      );

      if (createRoom.fulfilled.match(resultAction)) {
        setCreatedRoom(resultAction.payload);
      }
    } catch {
      // Handled by createRoom.rejected
    }
  };

  const handleOpenBoard = () => {
    if (createdRoom) {
      navigate(`/boards/${createdRoom.roomId}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose} role="dialog" aria-modal="true" aria-labelledby="create-board-title">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="create-board-title" className="modal-title">
            {createdRoom ? 'Board Created Successfully' : 'Create New Board'}
          </h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        {createdRoom ? (
          <div className="modal-body">
            <div className="alert alert-success">
              <span>✓ Board <strong>{createdRoom.name}</strong> is ready!</span>
            </div>
            <div className="created-board-details">
              <div className="meta-item">
                <span className="meta-label">Room ID:</span>
                <span className="meta-value font-mono">#{createdRoom.roomId}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Access:</span>
                <span className="meta-value capitalize">{createdRoom.access}</span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
              >
                Back to Dashboard
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleOpenBoard}
              >
                Open Board Now
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="modal-body">
              {(clientError || createError) && (
                <div className="alert alert-error" role="alert">
                  <span>{clientError || createError}</span>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="board-name" className="form-label">
                  Board Name <span className="required-indicator">*</span>
                </label>
                <input
                  id="board-name"
                  type="text"
                  className={`form-input ${clientError ? 'has-error' : ''}`}
                  placeholder="e.g., Sprint Planning, Design System"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (clientError) setClientError(null);
                  }}
                  disabled={isCreating}
                  maxLength={100}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Access Type</label>
                <div className="access-options">
                  <label className={`access-option-card ${access === 'public' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="accessType"
                      value="public"
                      checked={access === 'public'}
                      onChange={() => setAccess('public')}
                      disabled={isCreating}
                    />
                    <div className="access-option-info">
                      <div className="access-option-title">
                        <span className="access-badge badge-public">Public</span>
                      </div>
                      <p className="access-option-desc">
                        Anyone with the Room ID or share link can view and collaborate.
                      </p>
                    </div>
                  </label>

                  <label className={`access-option-card ${access === 'private' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="accessType"
                      value="private"
                      checked={access === 'private'}
                      onChange={() => setAccess('private')}
                      disabled={isCreating}
                    />
                    <div className="access-option-info">
                      <div className="access-option-title">
                        <span className="access-badge badge-private">Private</span>
                      </div>
                      <p className="access-option-desc">
                        Restricted strictly to the room owner and invited collaborators.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isCreating}
              >
                {isCreating ? (
                  <>
                    <span className="spinner" />
                    <span>Creating Board...</span>
                  </>
                ) : (
                  'Create Board'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
