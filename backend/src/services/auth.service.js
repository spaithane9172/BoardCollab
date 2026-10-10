const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      name: user.name
    },
    secret,
    { expiresIn }
  );
};

const register = async ({ name, email, password }) => {
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    const error = new Error('Name must be at least 2 characters long');
    error.statusCode = 400;
    throw error;
  }

  if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
    const error = new Error('A valid email address is required');
    error.statusCode = 400;
    throw error;
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    const error = new Error('Password must be at least 6 characters long');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check for existing user
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    const error = new Error('An account with this email already exists');
    error.statusCode = 409;
    throw error;
  }

  // Hash password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Save new user
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash
  });

  const token = generateToken(user);

  return {
    user: user.toJSON(),
    token
  };
};

const login = async ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('Email and password are required');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  const token = generateToken(user);

  return {
    user: user.toJSON(),
    token
  };
};

module.exports = {
  register,
  login,
  generateToken
};
