const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_phase4_2_rooms';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p4_2';

const app = require('../src/app');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');

describe('Phase 4.2: Authorized User Room List (GET /api/rooms)', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userAId;
  let userBToken;
  let userBId;
  let userAPublicRoom;
  let userAPrivateRoom;
  let userBPrivateRoom;

  const request = async (method, path, options = {}) => {
    const url = `${baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const res = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  before(async () => {
    await mongoose.connect(TEST_DB_URI);
    await User.deleteMany({});
    await Room.deleteMany({});

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // Register User A
    const resA = await request('POST', '/api/auth/register', {
      body: { name: 'User A', email: 'userA@example.com', password: 'password123' }
    });
    assert.strictEqual(resA.status, 201);
    userAToken = resA.data.data.token;
    userAId = resA.data.data.user._id;

    // Register User B
    const resB = await request('POST', '/api/auth/register', {
      body: { name: 'User B', email: 'userB@example.com', password: 'password123' }
    });
    assert.strictEqual(resB.status, 201);
    userBToken = resB.data.data.token;
    userBId = resB.data.data.user._id;
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects unauthenticated requests to GET /api/rooms with 401', async () => {
    const res = await request('GET', '/api/rooms');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.status, 'error');
  });

  it('returns an empty array when the user has no rooms', async () => {
    const res = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'success');
    assert.ok(Array.isArray(res.data.data));
    assert.strictEqual(res.data.data.length, 0);
  });

  it('returns boards created by the user (both public and private)', async () => {
    // Create public room for user A
    const pubRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` },
      body: { name: 'Alpha Public Board', access: 'public' }
    });
    assert.strictEqual(pubRes.status, 201);
    userAPublicRoom = pubRes.data.data;

    // Create private room for user A
    const privRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` },
      body: { name: 'Alpha Secret Board', access: 'private' }
    });
    assert.strictEqual(privRes.status, 201);
    userAPrivateRoom = privRes.data.data;

    const listRes = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` }
    });
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.data.data.length, 2);

    const roomIds = listRes.data.data.map((r) => r.roomId);
    assert.ok(roomIds.includes(userAPublicRoom.roomId));
    assert.ok(roomIds.includes(userAPrivateRoom.roomId));
  });

  it('never exposes private boards of other users to unauthorized users', async () => {
    // User B creates a private board
    const bPrivRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${userBToken}` },
      body: { name: 'Beta Confidential Board', access: 'private' }
    });
    assert.strictEqual(bPrivRes.status, 201);
    userBPrivateRoom = bPrivRes.data.data;

    // User A fetches their rooms
    const aList = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` }
    });
    assert.strictEqual(aList.status, 200);
    const aRoomIds = aList.data.data.map((r) => r.roomId);
    // User A should NOT see User B's private board
    assert.strictEqual(aRoomIds.includes(userBPrivateRoom.roomId), false);

    // User B fetches their rooms
    const bList = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    assert.strictEqual(bList.status, 200);
    const bRoomIds = bList.data.data.map((r) => r.roomId);
    assert.ok(bRoomIds.includes(userBPrivateRoom.roomId));
  });

  it('includes a room in board list after joining a public room', async () => {
    // User B joins User A's public room
    const joinRes = await request('POST', `/api/rooms/${userAPublicRoom.roomId}/join`, {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    assert.strictEqual(joinRes.status, 200);

    // User B fetches rooms: should now contain Alpha Public Board
    const bList = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    assert.strictEqual(bList.status, 200);
    const bRoomIds = bList.data.data.map((r) => r.roomId);
    assert.ok(bRoomIds.includes(userAPublicRoom.roomId));
  });

  it('includes a private room after being invited/added as a member', async () => {
    // User A invites User B to Alpha Secret Board
    const addRes = await request('POST', `/api/rooms/${userAPrivateRoom.roomId}/members`, {
      headers: { Authorization: `Bearer ${userAToken}` },
      body: { email: 'userb@example.com' }
    });
    assert.strictEqual(addRes.status, 200);

    // User B should now see Alpha Secret Board
    const bList = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    assert.strictEqual(bList.status, 200);
    const bRoomIds = bList.data.data.map((r) => r.roomId);
    assert.ok(bRoomIds.includes(userAPrivateRoom.roomId));
  });

  it('removes a room from board list after user leaves', async () => {
    // User B leaves User A's public room
    const leaveRes = await request('POST', `/api/rooms/${userAPublicRoom.roomId}/leave`, {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    assert.strictEqual(leaveRes.status, 200);

    const bList = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    assert.strictEqual(bList.status, 200);
    const bRoomIds = bList.data.data.map((r) => r.roomId);
    assert.strictEqual(bRoomIds.includes(userAPublicRoom.roomId), false);
  });

  it('does not expose password hashes in populated fields', async () => {
    const listRes = await request('GET', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` }
    });
    assert.strictEqual(listRes.status, 200);

    for (const room of listRes.data.data) {
      assert.strictEqual(room.owner.passwordHash, undefined);
      assert.ok(room.owner.name);
      assert.ok(room.owner.email);

      for (const member of room.members) {
        assert.strictEqual(member.passwordHash, undefined);
        assert.ok(member.name);
        assert.ok(member.email);
      }
    }
  });
});
