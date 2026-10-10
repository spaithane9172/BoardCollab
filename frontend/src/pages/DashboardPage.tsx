import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/store';
import { fetchRooms, clearRoomError } from '../store/room.slice';
import { socketService } from '../services/socket.service';
import { BoardCard } from '../components/BoardCard';
import { CreateBoardModal } from '../components/CreateBoardModal';
import { JoinBoardModal } from '../components/JoinBoardModal';

export const DashboardPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);
  const { rooms, isLoading, error } = useAppSelector((state) => state.rooms);

  const [socketConnected, setSocketConnected] = useState<boolean>(socketService.isConnected());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    // Fetch rooms on mount
    dispatch(fetchRooms());

    // Listen to real-time socket connection state
    const unsubscribe = socketService.onConnectionChange((connected) => {
      setSocketConnected(connected);
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  const handleRetry = () => {
    dispatch(clearRoomError());
    dispatch(fetchRooms());
  };

  const filteredRooms = rooms.filter((room) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      room.name.toLowerCase().includes(q) ||
      room.roomId.toLowerCase().includes(q) ||
      room.access.toLowerCase().includes(q) ||
      (room.owner?.name && room.owner.name.toLowerCase().includes(q))
    );
  });

  const publicCount = rooms.filter((r) => r.access === 'public').length;
  const privateCount = rooms.filter((r) => r.access === 'private').length;

  return (
    <div className="dashboard-page">
      <div className="container">
        {/* Top Header */}
        <div className="dashboard-header">
          <div>
            <h1 className="welcome-title">Welcome back, {user?.name || 'Collaborator'}!</h1>
            <p className="welcome-subtitle">
              Manage your collaborative whiteboards, organize sessions, and invite teammates.
            </p>
          </div>

          <div className="header-actions">
            {/* Real-Time Socket Connection Pill */}
            <span
              className={`socket-status-pill ${socketConnected ? 'connected' : 'disconnected'}`}
              title={socketConnected ? 'Connected to Socket.IO collaboration gateway' : 'Disconnected from real-time gateway'}
            >
              <span className="status-dot" />
              {socketConnected ? 'Real-Time Connected' : 'Disconnected'}
            </span>

            {/* Action Buttons */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsJoinModalOpen(true)}
              id="join-board-btn"
            >
              Join Board
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsCreateModalOpen(true)}
              id="create-board-btn"
            >
              + Create Board
            </button>
          </div>
        </div>

        {/* Workspace Summary Cards */}
        <div className="stat-grid">
          <div className="card">
            <h2 className="card-title">Total Boards</h2>
            <div className="card-value">{isLoading ? '...' : rooms.length}</div>
            <p className="stat-subtext">Active collaborative workspaces</p>
          </div>

          <div className="card">
            <h2 className="card-title">Public Boards</h2>
            <div className="card-value">{isLoading ? '...' : publicCount}</div>
            <p className="stat-subtext">Accessible with Room ID</p>
          </div>

          <div className="card">
            <h2 className="card-title">Private Boards</h2>
            <div className="card-value">{isLoading ? '...' : privateCount}</div>
            <p className="stat-subtext">Invite-only collaboration</p>
          </div>
        </div>

        {/* Boards Section Header & Search */}
        <div className="boards-section-header">
          <div className="section-title-wrap">
            <h2 className="section-title">Your Workspaces</h2>
            <span className="boards-count-tag">{filteredRooms.length} available</span>
          </div>

          {rooms.length > 0 && (
            <div className="search-box">
              <input
                type="text"
                className="form-input search-input"
                placeholder="Search boards by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search boards"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  &times;
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content Area: Loading, Error, Empty, or Grid */}
        {isLoading && rooms.length === 0 ? (
          <div className="dashboard-loading-state" role="status">
            <div className="spinner spinner-lg" />
            <p>Loading your collaborative boards...</p>
          </div>
        ) : error ? (
          <div className="alert alert-error dashboard-error-state" role="alert">
            <div className="error-content">
              <strong>Error loading boards:</strong>
              <p>{error}</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : rooms.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-wrap">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <h3 className="empty-title">No boards found</h3>
            <p className="empty-description">
              You haven't created or joined any collaborative whiteboards yet. Get started by creating your first
              board or joining a colleague's room.
            </p>
            <div className="empty-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsJoinModalOpen(true)}
              >
                Join with Room ID
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsCreateModalOpen(true)}
              >
                + Create Your First Board
              </button>
            </div>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="empty-state search-empty">
            <p>No boards match "<strong>{searchQuery}</strong>"</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSearchQuery('')}
            >
              Clear Search Filter
            </button>
          </div>
        ) : (
          <div className="board-grid">
            {filteredRooms.map((room) => (
              <BoardCard
                key={room.roomId}
                room={room}
                currentUserId={user?._id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateBoardModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
      <JoinBoardModal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
      />
    </div>
  );
};
