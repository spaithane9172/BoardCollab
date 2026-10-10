import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Room } from '../types/room.types';

interface BoardCardProps {
  room: Room;
  currentUserId?: string;
}

export const BoardCard: React.FC<BoardCardProps> = ({ room, currentUserId }) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState<boolean>(false);

  const isOwner = Boolean(
    currentUserId &&
    (typeof room.owner === 'string'
      ? room.owner === currentUserId
      : room.owner?._id === currentUserId)
  );

  const memberCount = Array.isArray(room.members) ? room.members.length : 1;
  const isPrivate = room.access === 'private';

  const handleOpenBoard = () => {
    navigate(`/boards/${room.roomId}`);
  };

  const handleCopyLink = async () => {
    // Generate share link using the configured frontend origin and canonical room ID
    const shareLink = `${window.location.origin}/boards/${room.roomId}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        // Fallback for non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = shareLink;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const formattedDate = new Date(room.updatedAt || room.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="board-card" data-testid={`board-card-${room.roomId}`}>
      <div className="board-card-header">
        <div className="board-title-group">
          <h3 className="board-card-title" title={room.name}>
            {room.name}
          </h3>
          <span className="board-room-id">#{room.roomId}</span>
        </div>
        <div className="board-badges">
          <span className={`badge ${isPrivate ? 'badge-private' : 'badge-public'}`}>
            <span className="badge-dot" />
            {isPrivate ? 'Private' : 'Public'}
          </span>
          {isOwner ? (
            <span className="badge badge-owner">Owner</span>
          ) : (
            <span className="badge badge-member">Member</span>
          )}
        </div>
      </div>

      <div className="board-card-meta">
        <div className="meta-item">
          <span className="meta-label">Owner:</span>
          <span className="meta-value">{room.owner?.name || 'Unknown'}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Members:</span>
          <span className="meta-value">
            {memberCount} {memberCount === 1 ? 'collaborator' : 'collaborators'}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Updated:</span>
          <span className="meta-value">{formattedDate}</span>
        </div>
      </div>

      <div className="board-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleOpenBoard}
          aria-label={`Open board ${room.name}`}
        >
          Open Board
        </button>
        <button
          type="button"
          className={`btn btn-secondary btn-sm copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopyLink}
          aria-label={`Copy share link for ${room.name}`}
        >
          {copied ? '✓ Copied!' : 'Copy Share Link'}
        </button>
      </div>
    </div>
  );
};
