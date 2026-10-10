const canvasService = require('../services/canvas.service');

/**
 * Registers canvas event handlers for a connected socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
const registerCanvasHandlers = (io, socket) => {
  // Helper to verify socket has joined a room
  const getJoinedRoomId = () => {
    return socket.data.currentRoomId || null;
  };

  // Helper for drawing operations
  const handleDraw = async (payload, callback, forceStroke = false) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const roomId = getJoinedRoomId();

    if (!roomId) {
      return ack({
        status: 'error',
        message: 'Socket must join a room before modifying the canvas'
      });
    }

    try {
      const dataToSave =
        forceStroke && payload && typeof payload === 'object' && !payload.type
          ? { ...payload, type: 'stroke' }
          : payload;

      const metadata = {
        restore: Boolean(payload?.restore),
        clearEpoch: payload?.clearEpoch
      };

      const element = await canvasService.addElement(roomId, dataToSave, socket.data.user.id, metadata);

      // Acknowledge creator with accepted authoritative element
      ack({
        status: 'success',
        data: element
      });

      // Broadcast operation to all peers in the room (excluding sender)
      socket.to(roomId).emit('canvas-operation', {
        action: 'create',
        element
      });
    } catch (error) {
      return ack({
        status: 'error',
        message: error.message
      });
    }
  };

  // 1. Draw Element (supports stroke, rectangle, circle, text)
  socket.on('draw-element', (payload, callback) => handleDraw(payload, callback, false));

  // 1b. Draw Stroke (backward-compatible alias from assignment contract)
  socket.on('draw-stroke', (payload, callback) => handleDraw(payload, callback, true));

  // 2. Update Element
  socket.on('update-element', async (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const roomId = getJoinedRoomId();

    if (!roomId) {
      return ack({
        status: 'error',
        message: 'Socket must join a room before modifying the canvas'
      });
    }

    if (!payload || typeof payload !== 'object') {
      return ack({
        status: 'error',
        message: 'Payload must be an object'
      });
    }

    const elementId = payload.id || payload.elementId;
    if (!elementId || typeof elementId !== 'string') {
      return ack({
        status: 'error',
        message: 'Element ID is required for updates'
      });
    }

    // Changes may be nested inside payload.changes or at root
    const changes = payload.changes && typeof payload.changes === 'object' ? payload.changes : payload;
    const expectedVersion =
      payload.expectedVersion !== undefined
        ? payload.expectedVersion
        : (changes && changes.expectedVersion !== undefined ? changes.expectedVersion : undefined);

    const metadata = {
      expectedVersion,
      propertyClocks: payload.propertyClocks || (changes && changes.propertyClocks),
      clock: payload.clock !== undefined ? payload.clock : (changes && changes.clock),
      restore: Boolean(payload.restore || (changes && changes.restore)),
      clearEpoch: payload.clearEpoch !== undefined ? payload.clearEpoch : (changes && changes.clearEpoch)
    };

    try {
      const updatedElement = await canvasService.updateElement(
        roomId,
        elementId,
        changes,
        socket.data.user.id,
        metadata
      );

      ack({
        status: 'success',
        data: updatedElement
      });

      // Broadcast update to peers (excluding sender)
      socket.to(roomId).emit('canvas-operation', {
        action: 'update',
        element: updatedElement
      });
    } catch (error) {
      const response = {
        status: 'error',
        message: error.message
      };
      if (error.currentVersion !== undefined) {
        response.currentVersion = error.currentVersion;
      }
      if (error.expectedVersion !== undefined) {
        response.expectedVersion = error.expectedVersion;
      }
      return ack(response);
    }
  });

  // 3. Delete Element
  socket.on('delete-element', async (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const roomId = getJoinedRoomId();

    if (!roomId) {
      return ack({
        status: 'error',
        message: 'Socket must join a room before modifying the canvas'
      });
    }

    let elementId;
    if (typeof payload === 'string') {
      elementId = payload.trim();
    } else if (payload && typeof payload === 'object') {
      elementId = payload.id || payload.elementId;
    }

    if (!elementId || typeof elementId !== 'string') {
      return ack({
        status: 'error',
        message: 'Element ID is required for deletion'
      });
    }

    try {
      const result = await canvasService.deleteElement(roomId, elementId, socket.data.user.id);

      ack({
        status: 'success',
        data: result
      });

      // Broadcast deletion to peers (excluding sender)
      socket.to(roomId).emit('canvas-operation', {
        action: 'delete',
        elementId: result.id
      });
    } catch (error) {
      return ack({
        status: 'error',
        message: error.message
      });
    }
  });

  // 4. Clear Canvas
  socket.on('clear-canvas', async (callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const roomId = getJoinedRoomId();

    if (!roomId) {
      return ack({
        status: 'error',
        message: 'Socket must join a room before modifying the canvas'
      });
    }

    try {
      await canvasService.clear(roomId, socket.data.user.id);

      ack({
        status: 'success',
        message: 'Canvas cleared successfully'
      });

      // Broadcast clear operation to all peers in the room (excluding sender)
      socket.to(roomId).emit('canvas-operation', {
        action: 'clear',
        roomId
      });
    } catch (error) {
      return ack({
        status: 'error',
        message: error.message
      });
    }
  });
};

module.exports = registerCanvasHandlers;
