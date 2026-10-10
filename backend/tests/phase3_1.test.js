const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { io: Client } = require('socket.io-client');

// Test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_socket_31';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p31';

const app = require('../src/app');
const { initSocketIO, presenceManager } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');

describe('Phase 3.1: Socket.IO Foundation and Secure Room Joining Tests', () => {
  let server;
  let ioServer;
  let baseUrl;
  let socketUrl;

  let aliceToken;
  let aliceId;
  let bobToken;
  let bobId;
  let charlieToken;
  let charlieId;

  let publicRoomId;
  let privateRoomId;

  const openSockets = [];

  // Helper function to create authenticated client socket
  const createClientSocket = (token, options = {}) => {
    const socket = Client(socketUrl, {
      auth: token ? { token } : undefined,
      transports: ['websocket'],
      forceNew: true,
      autoConnect: false,
      ...options
    });
    openSockets.push(socket);
    return socket;
  };

  // Helper for REST requests
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
    presenceManager.clear();

    // Start combined HTTP + Socket.IO server
    server = http.createServer(app);
    ioServer = initSocketIO(server);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    socketUrl = `http://localhost:${port}`;

    // Register 3 users via REST
    const resAlice = await request('POST', '/api/auth/register', {
      body: { name: 'Alice', email: 'alice_s@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob', email: 'bob_s@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id;

    const resCharlie = await request('POST', '/api/auth/register', {
      body: { name: 'Charlie', email: 'charlie_s@example.com', password: 'Password123!' }
    });
    charlieToken = resCharlie.data.data.token;
    charlieId = resCharlie.data.data.user._id;

    // Create 1 public room and 1 private room via REST
    const resPub = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Public Canvas', access: 'public', roomId: 'socket-pub-1' }
    });
    publicRoomId = resPub.data.data.roomId;

    const resPriv = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Private Canvas', access: 'private', roomId: 'socket-priv-1' }
    });
    privateRoomId = resPriv.data.data.roomId;

    // Alice invites Bob to the private room via REST
    await request('POST', `/api/rooms/${privateRoomId}/members`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { email: 'bob_s@example.com' }
    });
  });

  after(async () => {
    // Close all open client sockets
    for (const s of openSockets) {
      if (s.connected) s.disconnect();
    }
    if (ioServer) ioServer.close();

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. WebSocket Authentication', () => {
    it('should successfully connect with a valid JWT in handshake auth', async () => {
      const client = createClientSocket(aliceToken);

      await new Promise((resolve, reject) => {
        client.on('connect', () => {
          assert.ok(client.connected);
          resolve();
        });
        client.on('connect_error', reject);
        client.connect();
      });
    });

    it('should reject connection when token is missing', async () => {
      const client = createClientSocket(null);

      await new Promise((resolve) => {
        client.on('connect_error', (err) => {
          assert.match(err.message, /authentication token is required/i);
          resolve();
        });
        client.connect();
      });
    });

    it('should reject connection when token is invalid or tampered', async () => {
      const client = createClientSocket('invalid.tampered.token');

      await new Promise((resolve) => {
        client.on('connect_error', (err) => {
          assert.match(err.message, /invalid or expired authentication token/i);
          resolve();
        });
        client.connect();
      });
    });

    it('should reject connection when token is expired', async () => {
      const expiredToken = jwt.sign(
        { id: aliceId, email: 'alice_s@example.com', name: 'Alice' },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      const client = createClientSocket(expiredToken);

      await new Promise((resolve) => {
        client.on('connect_error', (err) => {
          assert.match(err.message, /invalid or expired authentication token/i);
          resolve();
        });
        client.connect();
      });
    });
  });

  describe('2. Secure Room Joining & Acknowledgements', () => {
    it('should allow authorized user to join public room and receive empty canvas state and participants', async () => {
      const client = createClientSocket(aliceToken);
      await new Promise((res) => {
        client.on('connect', res);
        client.connect();
      });

      const ackResponse = await new Promise((resolve) => {
        client.emit('join-room', { roomId: publicRoomId }, resolve);
      });

      assert.strictEqual(ackResponse.status, 'success');
      assert.strictEqual(ackResponse.data.room.roomId, publicRoomId);
      assert.strictEqual(ackResponse.data.room.name, 'Public Canvas');
      assert.strictEqual(ackResponse.data.room.access, 'public');
      assert.deepStrictEqual(ackResponse.data.canvasState, []);
      assert.ok(Array.isArray(ackResponse.data.participants));
      assert.ok(ackResponse.data.participants.some((p) => p.id === aliceId));
    });

    it('should broadcast user-joined to other participants when a new user enters', async () => {
      const aliceClient = createClientSocket(aliceToken);
      const bobClient = createClientSocket(bobToken);

      await Promise.all([
        new Promise((res) => {
          aliceClient.on('connect', res);
          aliceClient.connect();
        }),
        new Promise((res) => {
          bobClient.on('connect', res);
          bobClient.connect();
        })
      ]);

      // Alice joins public room first
      await new Promise((res) => aliceClient.emit('join-room', { roomId: publicRoomId }, res));

      // Alice sets up listener for user-joined
      const userJoinedPromise = new Promise((resolve) => {
        aliceClient.on('user-joined', resolve);
      });

      // Bob joins public room
      const bobAck = await new Promise((res) =>
        bobClient.emit('join-room', { roomId: publicRoomId }, res)
      );
      assert.strictEqual(bobAck.status, 'success');

      // Verify Alice received user-joined event
      const eventData = await userJoinedPromise;
      assert.strictEqual(eventData.user.id, bobId);
      assert.strictEqual(eventData.user.name, 'Bob');
    });

    it('should not automatically add a public-room visitor to MongoDB room.members', async () => {
      // Charlie (who is not in members) connects and joins public room
      const charlieClient = createClientSocket(charlieToken);
      await new Promise((res) => {
        charlieClient.on('connect', res);
        charlieClient.connect();
      });

      const ack = await new Promise((res) =>
        charlieClient.emit('join-room', { roomId: publicRoomId }, res)
      );
      assert.strictEqual(ack.status, 'success');

      // Verify MongoDB room.members still only contains Alice
      const roomInDb = await Room.findOne({ roomId: publicRoomId });
      const memberIds = roomInDb.members.map((m) => m.toString());
      assert.strictEqual(memberIds.includes(charlieId), false, 'Charlie must not be added to room.members');
    });

    it('should allow room owner to join a private room', async () => {
      const aliceClient = createClientSocket(aliceToken);
      await new Promise((res) => {
        aliceClient.on('connect', res);
        aliceClient.connect();
      });

      const ack = await new Promise((res) =>
        aliceClient.emit('join-room', { roomId: privateRoomId }, res)
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.room.roomId, privateRoomId);
      assert.strictEqual(ack.data.room.access, 'private');
    });

    it('should allow authorized member (Bob) to join a private room', async () => {
      const bobClient = createClientSocket(bobToken);
      await new Promise((res) => {
        bobClient.on('connect', res);
        bobClient.connect();
      });

      const ack = await new Promise((res) =>
        bobClient.emit('join-room', { roomId: privateRoomId }, res)
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.room.roomId, privateRoomId);
    });

    it('should reject unauthorized user (Charlie) from joining a private room', async () => {
      const charlieClient = createClientSocket(charlieToken);
      await new Promise((res) => {
        charlieClient.on('connect', res);
        charlieClient.connect();
      });

      const ack = await new Promise((res) =>
        charlieClient.emit('join-room', { roomId: privateRoomId }, res)
      );

      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /access denied/i);
    });

    it('should reject joining a nonexistent room', async () => {
      const aliceClient = createClientSocket(aliceToken);
      await new Promise((res) => {
        aliceClient.on('connect', res);
        aliceClient.connect();
      });

      const ack = await new Promise((res) =>
        aliceClient.emit('join-room', { roomId: 'nonexistent-room-404' }, res)
      );

      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /room not found/i);
    });
  });

  describe('3. Disconnect Handling and Duplicate Connections', () => {
    it('should maintain user presence when a user has multiple active connections and disconnects one', async () => {
      // Unique room for presence test
      const testRoomRes = await request('POST', '/api/rooms', {
        headers: { Authorization: `Bearer ${aliceToken}` },
        body: { name: 'Presence Test Room', access: 'public', roomId: 'socket-presence-1' }
      });
      const testRoomId = testRoomRes.data.data.roomId;

      // Bob client 1
      const bobClient1 = createClientSocket(bobToken);
      // Bob client 2 (e.g. 2nd browser tab)
      const bobClient2 = createClientSocket(bobToken);
      // Charlie observer client
      const charlieClient = createClientSocket(charlieToken);

      await Promise.all([
        new Promise((res) => {
          bobClient1.on('connect', res);
          bobClient1.connect();
        }),
        new Promise((res) => {
          bobClient2.on('connect', res);
          bobClient2.connect();
        }),
        new Promise((res) => {
          charlieClient.on('connect', res);
          charlieClient.connect();
        })
      ]);

      // Charlie joins first
      await new Promise((res) => charlieClient.emit('join-room', { roomId: testRoomId }, res));

      // Bob connects tab 1
      await new Promise((res) => bobClient1.emit('join-room', { roomId: testRoomId }, res));

      // Bob connects tab 2
      await new Promise((res) => bobClient2.emit('join-room', { roomId: testRoomId }, res));

      let userLeftEmitted = false;
      charlieClient.on('user-left', () => {
        userLeftEmitted = true;
      });

      // Bob disconnects tab 1
      bobClient1.disconnect();

      // Small pause to allow socket disconnect processing
      await new Promise((res) => setTimeout(res, 50));

      // Charlie should NOT have received 'user-left' because Bob still has tab 2 connected!
      assert.strictEqual(userLeftEmitted, false, 'User must not be marked left while tab 2 is still open');

      // Now Bob disconnects tab 2 (last remaining connection)
      const userLeftPromise = new Promise((resolve) => {
        charlieClient.on('user-left', resolve);
      });

      bobClient2.disconnect();

      const leftEventData = await userLeftPromise;
      assert.strictEqual(leftEventData.user.id, bobId);
    });
  });

  describe('4. Regression: Existing REST APIs Remain Functional', () => {
    it('should preserve GET /api/health', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
    });

    it('should preserve REST user login', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: { email: 'alice_s@example.com', password: 'Password123!' }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.token);
    });

    it('should preserve REST room retrieval', async () => {
      const res = await request('GET', `/api/rooms/${publicRoomId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.roomId, publicRoomId);
    });
  });
});
