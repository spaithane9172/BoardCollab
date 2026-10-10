const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');

// Test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_membership_987';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test';

const app = require('../src/app');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');

describe('Phase 2.1: Room Membership and Authorization Review Tests', () => {
  let server;
  let baseUrl;
  let aliceToken;
  let aliceId;
  let bobToken;
  let bobId;
  let charlieToken;
  let charlieId;
  let publicRoomId;
  let privateRoomId;

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

    // Setup 3 users: Alice (owner), Bob (member/collaborator), Charlie (outsider)
    const resAlice = await request('POST', '/api/auth/register', {
      body: { name: 'Alice Owner', email: 'alice_p21@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob Member', email: 'bob_p21@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id;

    const resCharlie = await request('POST', '/api/auth/register', {
      body: { name: 'Charlie Outsider', email: 'charlie_p21@example.com', password: 'Password123!' }
    });
    charlieToken = resCharlie.data.data.token;
    charlieId = resCharlie.data.data.user._id;
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

  describe('1. Owner Membership Initialization', () => {
    it('should initialize the owner as a member automatically upon room creation', async () => {
      const resPublic = await request('POST', '/api/rooms', {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { name: 'Alice Public Canvas', access: 'public', roomId: 'alice-pub-1' }
      });

      assert.strictEqual(resPublic.status, 201);
      assert.strictEqual(resPublic.data.data.owner._id, aliceId);
      assert.strictEqual(resPublic.data.data.members.length, 1);
      assert.strictEqual(resPublic.data.data.members[0]._id, aliceId);
      publicRoomId = resPublic.data.data.roomId;

      const resPrivate = await request('POST', '/api/rooms', {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { name: 'Alice Private Vault', access: 'private', roomId: 'alice-priv-1' }
      });

      assert.strictEqual(resPrivate.status, 201);
      assert.strictEqual(resPrivate.data.data.owner._id, aliceId);
      assert.strictEqual(resPrivate.data.data.members.length, 1);
      assert.strictEqual(resPrivate.data.data.members[0]._id, aliceId);
      privateRoomId = resPrivate.data.data.roomId;
    });
  });

  describe('2. Public Room Joining and Duplicate Prevention', () => {
    it('should allow an authenticated user (Bob) to join a public room', async () => {
      const res = await request('POST', `/api/rooms/${publicRoomId}/join`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.message, 'Successfully joined the room');
      assert.strictEqual(res.data.data.members.length, 2);

      const memberIds = res.data.data.members.map((m) => m._id);
      assert.ok(memberIds.includes(aliceId));
      assert.ok(memberIds.includes(bobId));
    });

    it('should prevent duplicate membership when joining the public room again', async () => {
      const res = await request('POST', `/api/rooms/${publicRoomId}/join`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.message, 'Already a member of this room');
      assert.strictEqual(res.data.data.members.length, 2, 'Members count must not increase');
    });

    it('should prevent duplicate membership when owner attempts to join their own room', async () => {
      const res = await request('POST', `/api/rooms/${publicRoomId}/join`, {
        headers: { Authorization: `Bearer ${aliceToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.message, 'Already a member of this room');
      assert.strictEqual(res.data.data.members.length, 2);
    });

    it('should reject unauthenticated attempt to join a public room', async () => {
      const res = await request('POST', `/api/rooms/${publicRoomId}/join`);
      assert.strictEqual(res.status, 401);
    });
  });

  describe('3. Private Room Protection & Direct Joining Denial', () => {
    it('should reject direct joining of a private room (Bob cannot join directly)', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/join`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /cannot directly join a private room/i);
    });
  });

  describe('4. Authorized Private-Room Invitations / Member Management', () => {
    it('should allow the room owner (Alice) to add Bob to the private room by email', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { email: 'bob_p21@example.com' }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.message, 'Member added successfully');
      assert.strictEqual(res.data.data.members.length, 2);

      const memberEmails = res.data.data.members.map((m) => m.email);
      assert.ok(memberEmails.includes('bob_p21@example.com'));
    });

    it('should allow Bob to retrieve the private room now that he is an authorized member', async () => {
      const res = await request('GET', `/api/rooms/${privateRoomId}`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.roomId, privateRoomId);
    });

    it('should reject adding a user who is already a member (duplicate prevention)', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { email: 'bob_p21@example.com' }
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /already a member/i);
    });

    it('should reject adding the owner as a member', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { email: 'alice_p21@example.com' }
      });

      assert.strictEqual(res.status, 409);
      assert.match(res.data.message, /already a member/i);
    });

    it('should return 404 when attempting to add a non-existent email', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { email: 'doesnotexist_999@example.com' }
      });

      assert.strictEqual(res.status, 404);
      assert.match(res.data.message, /user to add not found/i);
    });
  });

  describe('5. Unauthorized Membership Modification', () => {
    it('should reject non-owner (Bob or Charlie) attempting to add members to a room', async () => {
      // Bob is a member, but NOT the owner
      const resBob = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        headers: { Authorization: `Bearer ${bobToken}` },
        body: { email: 'charlie_p21@example.com' }
      });

      assert.strictEqual(resBob.status, 403);
      assert.match(resBob.data.message, /only the room owner can add members/i);

      // Charlie is completely outside the room
      const resCharlie = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        headers: { Authorization: `Bearer ${charlieToken}` },
        body: { email: 'alice_p21@example.com' }
      });

      assert.strictEqual(resCharlie.status, 403);
      assert.match(resCharlie.data.message, /only the room owner can add members/i);
    });

    it('should reject unauthenticated request to add members', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/members`, {
        body: { email: 'charlie_p21@example.com' }
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('6. Leave Restrictions (Owner vs Member)', () => {
    it('should reject room owner attempting to leave their own room', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/leave`, {
        headers: { Authorization: `Bearer ${aliceToken}` }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /room owner cannot leave the room/i);
    });

    it('should reject non-member (Charlie) attempting to leave a room', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/leave`, {
        headers: { Authorization: `Bearer ${charlieToken}` }
      });

      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /you are not a member of this room/i);
    });

    it('should allow an authorized member (Bob) to leave the private room', async () => {
      const res = await request('POST', `/api/rooms/${privateRoomId}/leave`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.message, 'Successfully left the room');
    });

    it('should deny Bob access to the private room now that he has left', async () => {
      const res = await request('GET', `/api/rooms/${privateRoomId}`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /access denied/i);
    });
  });

  describe('7. Read-Only Retrieval Guarantee', () => {
    it('should retrieve room details without mutating the members array', async () => {
      // Get room before
      const resBefore = await request('GET', `/api/rooms/${publicRoomId}`);
      assert.strictEqual(resBefore.status, 200);
      const membersBeforeCount = resBefore.data.data.members.length;

      // Guest / unauthenticated read
      await request('GET', `/api/rooms/${publicRoomId}`);

      // Authenticated read with non-member (Charlie)
      const resCharlieRead = await request('GET', `/api/rooms/${publicRoomId}`, {
        headers: { Authorization: `Bearer ${charlieToken}` }
      });
      assert.strictEqual(resCharlieRead.status, 200);

      // Verify members count has NOT changed
      const resAfter = await request('GET', `/api/rooms/${publicRoomId}`);
      assert.strictEqual(resAfter.data.data.members.length, membersBeforeCount);
    });
  });
});
