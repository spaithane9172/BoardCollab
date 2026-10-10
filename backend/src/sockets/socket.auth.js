const jwt = require('jsonwebtoken');

/**
 * Socket.IO handshake authentication middleware.
 * Verifies JWT token supplied in socket.handshake.auth.token or headers.authorization.
 */
const socketAuthMiddleware = (socket, next) => {
  let token = socket.handshake.auth?.token;

  // Fallback to authorization header if provided
  if (!token && socket.handshake.headers?.authorization) {
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }

  if (!token) {
    return next(new Error('Authentication token is required'));
  }

  // Strip "Bearer " if included in auth.token
  if (typeof token === 'string' && token.startsWith('Bearer ')) {
    token = token.substring(7).trim();
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[Socket Auth] Missing JWT_SECRET environment variable');
    return next(new Error('Internal server authentication configuration error'));
  }

  try {
    const decoded = jwt.verify(token, secret);

    // Strictly attach server-verified identity; ignore any client-supplied user IDs
    socket.data.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name
    };

    return next();
  } catch (error) {
    return next(new Error('Invalid or expired authentication token'));
  }
};

module.exports = socketAuthMiddleware;
