import React, { useState } from 'react';
import { roomService } from '../services/room.service';
import type { Room } from '../types/room.types';

export interface InviteCollaboratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: Room;
  onMemberAdded?: (updatedRoom: Room) => void;
}

export const InviteCollaboratorModal: React.FC<InviteCollaboratorModalProps> = ({
  isOpen,
  onClose,
  room,
  onMemberAdded
}) => {
  const [email, setEmail] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setEmail('');
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Collaborator email address is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedRoom = await roomService.addMember(room.roomId, trimmedEmail);
      setSuccessMessage(`✓ Successfully added ${trimmedEmail} as collaborator!`);
      setEmail('');
      if (onMemberAdded) {
        onMemberAdded(updatedRoom);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to invite collaborator';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
      data-testid="invite-collaborator-backdrop"
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '440px' }}
        data-testid="invite-collaborator-modal"
      >
        <div className="modal-header">
          <h2 id="invite-modal-title" className="modal-title">
            Invite Collaborator
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Grant access to this private board (<strong>{room.name}</strong>) for a registered BoardCollab user by email.
            </p>

            {error && (
              <div className="alert alert-error" role="alert" data-testid="invite-error-alert">
                <span>{error}</span>
              </div>
            )}

            {successMessage && (
              <div className="alert alert-success" role="status" data-testid="invite-success-alert">
                <span>{successMessage}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="invite-email-input" className="form-label">
                User Email Address <span className="required-indicator">*</span>
              </label>
              <input
                id="invite-email-input"
                data-testid="invite-email-input"
                type="email"
                className={`form-input ${error ? 'has-error' : ''}`}
                placeholder="colleague@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isSubmitting}
                autoFocus
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
              disabled={isSubmitting}
              data-testid="invite-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !email.trim()}
              data-testid="invite-submit-btn"
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" />
                  <span>Inviting...</span>
                </>
              ) : (
                'Invite'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
