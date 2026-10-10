/**
 * In-memory presence manager for collaborative whiteboard rooms.
 * Supports multiple concurrent socket connections for the same user.
 */
class PresenceManager {
  constructor() {
    // Structure: Map<roomId, Map<userId, { user: { id, name }, sockets: Set<socketId> }>>
    this.rooms = new Map();
    // Structure: Map<socketId, { roomId, userId, user }>
    this.socketToRoom = new Map();
  }

  /**
   * Adds a socket connection for a user in a room.
   * @param {string} roomId
   * @param {{ id: string, name: string }} user
   * @param {string} socketId
   * @returns {{ isNewUser: boolean, participants: Array<{ id: string, name: string }> }}
   */
  addConnection(roomId, user, socketId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Map());
    }

    const roomMap = this.rooms.get(roomId);
    const userId = user.id.toString();

    let isNewUser = false;
    if (!roomMap.has(userId)) {
      roomMap.set(userId, {
        user: { id: userId, name: user.name },
        sockets: new Set()
      });
      isNewUser = true;
    }

    const entry = roomMap.get(userId);
    entry.sockets.add(socketId);

    // Track reverse lookup for fast disconnection handling
    this.socketToRoom.set(socketId, { roomId, userId, user: entry.user });

    const participants = this.getParticipants(roomId);

    return {
      isNewUser,
      participants
    };
  }

  /**
   * Removes a socket connection for a user in a room.
   * @param {string} socketId
   * @returns {{ roomId: string, user: { id: string, name: string }, isUserRemoved: boolean } | null}
   */
  removeConnection(socketId) {
    if (!this.socketToRoom.has(socketId)) {
      return null;
    }

    const { roomId, userId, user } = this.socketToRoom.get(socketId);
    this.socketToRoom.delete(socketId);

    const roomMap = this.rooms.get(roomId);
    if (!roomMap || !roomMap.has(userId)) {
      return null;
    }

    const entry = roomMap.get(userId);
    entry.sockets.delete(socketId);

    let isUserRemoved = false;
    if (entry.sockets.size === 0) {
      roomMap.delete(userId);
      isUserRemoved = true;
    }

    if (roomMap.size === 0) {
      this.rooms.delete(roomId);
    }

    return {
      roomId,
      user,
      isUserRemoved
    };
  }

  /**
   * Retrieves all unique active users in a room.
   * @param {string} roomId
   * @returns {Array<{ id: string, name: string }>}
   */
  getParticipants(roomId) {
    const roomMap = this.rooms.get(roomId);
    if (!roomMap) {
      return [];
    }

    return Array.from(roomMap.values()).map((entry) => entry.user);
  }

  /**
   * Clear all rooms (useful for testing)
   */
  clear() {
    this.rooms.clear();
    this.socketToRoom.clear();
  }
}

module.exports = new PresenceManager();
