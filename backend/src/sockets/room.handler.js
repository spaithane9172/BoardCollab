const mongoose = require('mongoose');
const Room = require('../models/room.model');
const presenceManager = require('./presence.manager');
const canvasService = require('../services/canvas.service');

/**
 * Registers room event handlers for a connected socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
const registerRoomHandlers = (io, socket) => {
  // Handle join-room event
  socket.on('join-room', async (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};

    try {
      // Extract room identifier whether passed as string or object { roomId }
      let identifier;
      if (typeof payload === 'string') {
        identifier = payload.trim();
      } else if (payload && typeof payload.roomId === 'string') {
        identifier = payload.roomId.trim();
      }

      if (!identifier) {
        return ack({
          status: 'error',
          message: 'Room identifier is required'
        });
      }

      // Load room from MongoDB
      const query = [{ roomId: identifier }];
      if (mongoose.Types.ObjectId.isValid(identifier)) {
        query.push({ _id: identifier });
      }

      const room = await Room.findOne({ $or: query })
        .populate('owner', 'name email')
        .populate('members', 'name email');

      if (!room) {
        return ack({
          status: 'error',
          message: 'Room not found'
        });
      }

      // Apply the same access policy as REST API
      const accessCheck = room.checkAccess(socket.data.user.id);
      if (!accessCheck.authorized) {
        return ack({
          status: 'error',
          message: accessCheck.reason || 'Access denied'
        });
      }

      // If socket was previously in another room, leave it
      const prevConnection = presenceManager.removeConnection(socket.id);
      if (prevConnection) {
        socket.leave(prevConnection.roomId);
        if (prevConnection.isUserRemoved) {
          io.to(prevConnection.roomId).emit('user-left', { user: prevConnection.user });
        }
      }

      // Join Socket.IO room channel
      socket.join(room.roomId);
      // Store current room on socket data
      socket.data.currentRoomId = room.roomId;

      // Add to presence manager
      const { isNewUser, participants } = presenceManager.addConnection(
        room.roomId,
        socket.data.user,
        socket.id
      );

      // If this is the user's first connection in this room, broadcast user-joined to peers
      if (isNewUser) {
        socket.to(room.roomId).emit('user-joined', {
          user: socket.data.user
        });
      }

      // Retrieve current authoritative persistent canvas state from MongoDB
      const canvasState = await canvasService.getElements(room.roomId);

      // Return structured success acknowledgement
      return ack({
        status: 'success',
        data: {
          room: {
            roomId: room.roomId,
            name: room.name,
            access: room.access
          },
          canvasState,
          participants
        }
      });
    } catch (error) {
      console.error('[Socket Room Handler Error]', error);
      return ack({
        status: 'error',
        message: 'Internal server error while joining room'
      });
    }
  });

  // Handle socket disconnection
  socket.on('disconnect', () => {
    socket.data.currentRoomId = null;
    const result = presenceManager.removeConnection(socket.id);
    if (result && result.isUserRemoved) {
      io.to(result.roomId).emit('user-left', {
        user: result.user
      });
    }
  });
};

module.exports = registerRoomHandlers;
