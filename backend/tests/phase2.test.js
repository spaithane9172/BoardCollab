const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_987654321';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p2';

const app = require('../src/app');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');

describe('Phase 2: Authentication and Room Management Tests', () => {
  let server;
  let baseUrl;
  let aliceToken;
  let aliceId;
  let bobToken;
  let bobId;
  let publicRoomId;
  let privateRoomId;

  // Helper function to make HTTP requests
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
    // Connect to isolated test database
    await mongoose.connect(TEST_DB_URI);
    await User.deleteMany({});
    await Room.deleteMany({});

    // Start ephemeral HTTP server
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    // Clean up isolated test database and close connections
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. Authentication Tests', () => {
    it('should successfully register a new user with hashed password and token', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: {
          name: 'Alice Developer',
          email: 'Alice@example.com', // test email normalization
          password: 'Password123!'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.user.email, 'alice@example.com');
      assert.strictEqual(res.data.data.user.name, 'Alice Developer');
      assert.strictEqual(res.data.data.user.passwordHash, undefined, 'passwordHash must never be exposed');
      assert.ok(res.data.data.token, 'JWT token should be returned');

      aliceToken = res.data.data.token;
      aliceId = res.data.data.user._id;
    });

    it('should reject registration with duplicate email (case-insensitive)', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: {
          name: 'Alice Imposter',
          email: 'alice@example.com',
          password: 'AnotherPassword123'
        }
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /already exists/i);
    });

    it('should reject registration with invalid input (short password, invalid email)', async () => {
      const invalidEmailRes = await request('POST', '/api/auth/register', {
        body: {
          name: 'Invalid User',
          email: 'not-an-email',
          password: 'validpassword'
        }
      });
      assert.strictEqual(invalidEmailRes.status, 400);

      const shortPasswordRes = await request('POST', '/api/auth/register', {
        body: {
          name: 'Invalid User',
          email: 'valid@example.com',
          password: '123'
        }
      });
      assert.strictEqual(shortPasswordRes.status, 400);
    });

    it('should successfully login with valid credentials and return JWT', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: {
          email: 'alice@example.com',
          password: 'Password123!'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.user.email, 'alice@example.com');
      assert.strictEqual(res.data.data.user.passwordHash, undefined);
      assert.ok(res.data.data.token);
    });

    it('should reject login with invalid credentials (wrong password)', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: {
          email: 'alice@example.com',
          password: 'WrongPassword!'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /invalid email or password/i);
    });

    it('should reject login with non-existent email', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: {
          email: 'nobody@example.com',
          password: 'Password123!'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /invalid email or password/i);
    });

    it('should register a second user (Bob) for cross-user authorization tests', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: {
          name: 'Bob Collaborator',
          email: 'bob@example.com',
          password: 'PasswordBob456!'
        }
      });

      assert.strictEqual(res.status, 201);
      bobToken = res.data.data.token;
      bobId = res.data.data.user._id;
    });
  });

  describe('2. Authentication Middleware Tests', () => {
    it('should reject room creation with missing JWT', async () => {
      const res = await request('POST', '/api/rooms', {
        body: { name: 'Unauthorized Room' }
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /authorization token is required/i);
    });

    it('should reject room creation with malformed authorization header', async () => {
      const res = await request('POST', '/api/rooms', {
        headers: { Authorization: 'Basic some-invalid-header' },
        body: { name: 'Malformed Token Room' }
      });

      assert.strictEqual(res.status, 401);
      assert.match(res.data.message, /malformed authorization header/i);
    });

    it('should reject room creation with invalid or tampered JWT', async () => {
      const res = await request('POST', '/api/rooms', {
        headers: { Authorization: 'Bearer this.is.a.fake.jwt.token' },
        body: { name: 'Fake Token Room' }
      });

      assert.strictEqual(res.status, 401);
      assert.match(res.data.message, /invalid or expired token/i);
    });
  });

  describe('3. Room Management & Authorization Tests', () => {
    it('should allow authenticated user to create a public room', async () => {
      const res = await request('POST', '/api/rooms', {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: {
          name: 'Public Design Sprint',
          access: 'public',
          roomId: 'public-sprint-1'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.name, 'Public Design Sprint');
      assert.strictEqual(res.data.data.roomId, 'public-sprint-1');
      assert.strictEqual(res.data.data.access, 'public');
      assert.strictEqual(res.data.data.owner._id, aliceId);

      publicRoomId = res.data.data.roomId;
    });

    it('should allow authenticated user to create a private room and prevent client owner spoofing', async () => {
      const fakeOwnerId = '666666666666666666666666';
      const res = await request('POST', '/api/rooms', {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: {
          name: 'Private Architecture Board',
          access: 'private',
          roomId: 'private-arch-1',
          owner: fakeOwnerId // Client attempt to spoof ownership
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.name, 'Private Architecture Board');
      assert.strictEqual(res.data.data.roomId, 'private-arch-1');
      assert.strictEqual(res.data.data.access, 'private');
      // Server must enforce that owner is Alice, not fakeOwnerId
      assert.strictEqual(res.data.data.owner._id, aliceId);
      assert.notStrictEqual(res.data.data.owner._id, fakeOwnerId);

      privateRoomId = res.data.data.roomId;
    });

    it('should permit unauthenticated requester to access a public room', async () => {
      const res = await request('GET', `/api/rooms/${publicRoomId}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.roomId, publicRoomId);
      assert.strictEqual(res.data.data.access, 'public');
    });

    it('should permit another authenticated user (Bob) to access a public room', async () => {
      const res = await request('GET', `/api/rooms/${publicRoomId}`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.roomId, publicRoomId);
    });

    it('should deny unauthenticated access to a private room (401)', async () => {
      const res = await request('GET', `/api/rooms/${privateRoomId}`);

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /authentication required/i);
    });

    it('should deny unauthorized user (Bob) access to Alice\'s private room (403)', async () => {
      const res = await request('GET', `/api/rooms/${privateRoomId}`, {
        headers: { Authorization: `Bearer ${bobToken}` }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /access denied/i);
    });

    it('should permit owner (Alice) to access her own private room', async () => {
      const res = await request('GET', `/api/rooms/${privateRoomId}`, {
        headers: { Authorization: `Bearer ${aliceToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'success');
      assert.strictEqual(res.data.data.roomId, privateRoomId);
      assert.strictEqual(res.data.data.owner._id, aliceId);
    });

    it('should return 404 for a non-existent room', async () => {
      const res = await request('GET', '/api/rooms/non-existent-room-999');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.status, 'error');
      assert.match(res.data.message, /room not found/i);
    });
  });

  describe('4. Regression: Health Endpoint', () => {
    it('should preserve GET /api/health functionality', async () => {
      const res = await request('GET', '/api/health');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
      assert.strictEqual(res.data.message, 'BoardCollab API is running');
      assert.ok(res.data.timestamp);
    });
  });
});
