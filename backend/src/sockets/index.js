const { Server } = require('socket.io');
const socketAuthMiddleware = require('./socket.auth');
const registerRoomHandlers = require('./room.handler');
const registerCanvasHandlers = require('./canvas.handler');
const presenceManager = require('./presence.manager');
const canvasService = require('../services/canvas.service');

/**
 * Initializes and attaches Socket.IO to the provided HTTP server.
 * @param {import('http').Server} server
 * @returns {import('socket.io').Server}
 */
const initSocketIO = (server) => {
  const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';

  const io = new Server(server, {
    cors: {
      origin: allowedOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Attach handshake authentication middleware
  io.use(socketAuthMiddleware);

  // Connection handler
  io.on('connection', (socket) => {
    // Register room event handlers
    registerRoomHandlers(io, socket);
    // Register canvas event handlers
    registerCanvasHandlers(io, socket);
  });

  return io;
};

module.exports = {
  initSocketIO,
  presenceManager,
  canvasService
};
