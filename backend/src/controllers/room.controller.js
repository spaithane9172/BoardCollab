const roomService = require('../services/room.service');
const canvasService = require('../services/canvas.service');
const exportService = require('../services/export.service');

const createRoom = async (req, res, next) => {
  try {
    const { name, access, roomId } = req.body;
    const userId = req.user.id;

    const room = await roomService.createRoom({
      name,
      access,
      roomId,
      userId
    });

    return res.status(201).json({
      status: 'success',
      message: 'Room created successfully',
      data: room
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        status: 'error',
        message: error.message
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'A room with this ID already exists'
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

const getRoom = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const room = await roomService.getRoomById(id, userId);

    return res.status(200).json({
      status: 'success',
      data: room
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

const joinRoom = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await roomService.joinPublicRoom(id, userId);

    return res.status(200).json({
      status: 'success',
      message: result.alreadyMember ? 'Already a member of this room' : 'Successfully joined the room',
      data: result.room
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

const addMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requesterId = req.user.id;
    const { email, userId } = req.body;

    const room = await roomService.addMember({
      identifier: id,
      requesterId,
      email,
      targetUserId: userId
    });

    return res.status(200).json({
      status: 'success',
      message: 'Member added successfully',
      data: room
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

const leaveRoom = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await roomService.leaveRoom(id, userId);

    return res.status(200).json({
      status: 'success',
      message: result.message,
      data: {
        roomId: result.roomId
      }
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

const getUserRooms = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const rooms = await roomService.getUserRooms(userId);

    return res.status(200).json({
      status: 'success',
      data: rooms
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

const exportRoomCanvas = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { backgroundColor, padding, allowEmpty } = req.body || {};

    // 1. Verify user has authorized access to room
    const room = await roomService.getRoomById(id, userId);

    // 2. Retrieve persisted canvas elements for this room
    const elements = await canvasService.getElements(room.roomId);

    // 3. Render PNG using node-canvas
    const pngBuffer = await exportService.renderCanvasToPng(elements, {
      backgroundColor,
      padding,
      allowEmpty: allowEmpty !== undefined ? Boolean(allowEmpty) : true
    });

    // 4. Return PNG binary
    const safeRoomId = String(room.roomId || 'export').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${safeRoomId}.png"`);
    res.setHeader('Content-Length', pngBuffer.length);
    return res.status(200).send(pngBuffer);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }

    next(error);
  }
};

module.exports = {
  createRoom,
  getRoom,
  getUserRooms,
  joinRoom,
  addMember,
  leaveRoom,
  exportRoomCanvas
};
