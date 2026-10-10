const jwt = require('jsonwebtoken');

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1];
  }
  return null;
};

/**
 * Strict authentication middleware: requires a valid JWT.
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      status: 'error',
      message: 'Authorization token is required'
    });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Malformed authorization header. Expected "Bearer <token>"'
    });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[Auth Error] JWT_SECRET environment variable is missing');
    return res.status(500).json({
      status: 'error',
      message: 'Internal server authentication error'
    });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
  }
};

/**
 * Optional authentication middleware: attaches req.user if a valid token is provided.
 * If header is provided but invalid, returns 401. If no header, proceeds with req.user = null.
 */
const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.user = null;
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Malformed authorization header. Expected "Bearer <token>"'
    });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[Auth Error] JWT_SECRET environment variable is missing');
    return res.status(500).json({
      status: 'error',
      message: 'Internal server authentication error'
    });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
  }
};

module.exports = {
  authenticate,
  optionalAuthenticate
};
