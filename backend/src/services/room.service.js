const crypto = require('crypto');
const mongoose = require('mongoose');
const Room = require('../models/room.model');
const User = require('../models/user.model');

const generateRoomId = () => {
  return `room-${crypto.randomBytes(4).toString('hex')}`;
};

const findRoomByIdentifier = (identifier) => {
  const query = [{ roomId: identifier }];
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    query.push({ _id: identifier });
  }
  return Room.findOne({ $or: query });
};

const createRoom = async ({ name, access, roomId, userId }) => {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    const error = new Error('Room name is required');
    error.statusCode = 400;
    throw error;
  }

  let finalAccess = 'public';
  if (access) {
    if (!['public', 'private'].includes(access)) {
      const error = new Error('Access must be either "public" or "private"');
      error.statusCode = 400;
      throw error;
    }
    finalAccess = access;
  }

  let finalRoomId = roomId ? roomId.trim() : generateRoomId();

  // Validate format if custom roomId is provided
  const roomIdRegex = /^[a-zA-Z0-9_-]{3,64}$/;
  if (!roomIdRegex.test(finalRoomId)) {
    const error = new Error('Room ID must be 3-64 characters alphanumeric, underscores or hyphens');
    error.statusCode = 400;
    throw error;
  }

  // Check if roomId already exists
  const existing = await Room.findOne({ roomId: finalRoomId });
  if (existing) {
    const error = new Error(`Room with ID "${finalRoomId}" already exists`);
    error.statusCode = 409;
    throw error;
  }

  // Security enforcement: client cannot specify owner or arbitrary members
  const room = await Room.create({
    roomId: finalRoomId,
    name: name.trim(),
    access: finalAccess,
    owner: userId,
    members: [userId]
  });

  const populatedRoom = await Room.findById(room._id)
    .populate('owner', 'name email')
    .populate('members', 'name email');

  return populatedRoom;
};

const getRoomById = async (identifier, userId) => {
  if (!identifier) {
    const error = new Error('Room identifier is required');
    error.statusCode = 400;
    throw error;
  }

  // Read-only retrieval: does NOT mutate members
  const room = await findRoomByIdentifier(identifier)
    .populate('owner', 'name email')
    .populate('members', 'name email');

  if (!room) {
    const error = new Error('Room not found');
    error.statusCode = 404;
    throw error;
  }

  // Verify authorization
  const accessCheck = room.checkAccess(userId);
  if (!accessCheck.authorized) {
    const error = new Error(accessCheck.reason);
    error.statusCode = accessCheck.statusCode || 403;
    throw error;
  }

  return room;
};

const joinPublicRoom = async (identifier, userId) => {
  if (!identifier) {
    const error = new Error('Room identifier is required');
    error.statusCode = 400;
    throw error;
  }

  const room = await findRoomByIdentifier(identifier);
  if (!room) {
    const error = new Error('Room not found');
    error.statusCode = 404;
    throw error;
  }

  // Direct joining is strictly prohibited for private rooms
  if (room.access === 'private') {
    const error = new Error('Cannot directly join a private room. You must be invited by the room owner.');
    error.statusCode = 403;
    throw error;
  }

  const userIdStr = userId.toString();
  const isOwner = room.owner.toString() === userIdStr;
  const isMember = room.members.some((m) => m.toString() === userIdStr);

  // Avoid duplicate membership
  if (!isMember && !isOwner) {
    room.members.push(userId);
    await room.save();
  }

  const populatedRoom = await Room.findById(room._id)
    .populate('owner', 'name email')
    .populate('members', 'name email');

  return {
    room: populatedRoom,
    alreadyMember: isMember || isOwner
  };
};

const addMember = async ({ identifier, requesterId, email, targetUserId }) => {
  if (!identifier) {
    const error = new Error('Room identifier is required');
    error.statusCode = 400;
    throw error;
  }

  if (!email && !targetUserId) {
    const error = new Error('User email or user ID is required to add a member');
    error.statusCode = 400;
    throw error;
  }

  const room = await findRoomByIdentifier(identifier);
  if (!room) {
    const error = new Error('Room not found');
    error.statusCode = 404;
    throw error;
  }

  // Authorization check: Only the room owner can add members
  if (room.owner.toString() !== requesterId.toString()) {
    const error = new Error('Only the room owner can add members to this room');
    error.statusCode = 403;
    throw error;
  }

  // Find target user to add
  let targetUser;
  if (email && typeof email === 'string') {
    targetUser = await User.findOne({ email: email.trim().toLowerCase() });
  } else if (targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)) {
    targetUser = await User.findById(targetUserId);
  }

  if (!targetUser) {
    const error = new Error('User to add not found');
    error.statusCode = 404;
    throw error;
  }

  const targetUserIdStr = targetUser._id.toString();

  // Prevent duplicate membership or adding owner
  const isOwner = room.owner.toString() === targetUserIdStr;
  const isAlreadyMember = room.members.some((m) => m.toString() === targetUserIdStr);

  if (isOwner || isAlreadyMember) {
    const error = new Error('User is already a member of this room');
    error.statusCode = 409;
    throw error;
  }

  room.members.push(targetUser._id);
  await room.save();

  const populatedRoom = await Room.findById(room._id)
    .populate('owner', 'name email')
    .populate('members', 'name email');

  return populatedRoom;
};

const leaveRoom = async (identifier, userId) => {
  if (!identifier) {
    const error = new Error('Room identifier is required');
    error.statusCode = 400;
    throw error;
  }

  const room = await findRoomByIdentifier(identifier);
  if (!room) {
    const error = new Error('Room not found');
    error.statusCode = 404;
    throw error;
  }

  const userIdStr = userId.toString();

  // Ownership rule: Owner cannot leave the room
  if (room.owner.toString() === userIdStr) {
    const error = new Error('Room owner cannot leave the room');
    error.statusCode = 400;
    throw error;
  }

  // Membership check
  const memberIndex = room.members.findIndex((m) => m.toString() === userIdStr);
  if (memberIndex === -1) {
    const error = new Error('You are not a member of this room');
    error.statusCode = 400;
    throw error;
  }

  room.members.splice(memberIndex, 1);
  await room.save();

  return {
    roomId: room.roomId,
    message: 'Successfully left the room'
  };
};

const getUserRooms = async (userId) => {
  if (!userId) {
    const error = new Error('User ID is required');
    error.statusCode = 400;
    throw error;
  }

  // Return rooms the user owns or is a member of, sorted newest first
  const rooms = await Room.find({
    $or: [{ owner: userId }, { members: userId }]
  })
    .sort({ updatedAt: -1 })
    .populate('owner', 'name email')
    .populate('members', 'name email');

  return rooms;
};

module.exports = {
  createRoom,
  getRoomById,
  getUserRooms,
  joinPublicRoom,
  addMember,
  leaveRoom
};
