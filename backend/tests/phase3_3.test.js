const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

// Test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_persist_33';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p33';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');

describe('Phase 3.3: MongoDB Canvas Persistence Tests', () => {
  let server;
  let ioServer;
  let baseUrl;
  let socketUrl;

  let aliceToken;
  let aliceId;
  let bobToken;
  let bobId;

  let roomAlphaId;
  let roomBetaId;

  const openSockets = [];

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
    await CanvasElement.deleteMany({});
    presenceManager.clear();

    server = http.createServer(app);
    ioServer = initSocketIO(server);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    socketUrl = `http://localhost:${port}`;

    // Register users
    const resAlice = await request('POST', '/api/auth/register', {
      body: { name: 'Alice Mongoose', email: 'alice_mongo@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob Mongoose', email: 'bob_mongo@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id;

    // Create 2 separate rooms
    const r1 = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Persistent Room Alpha', access: 'public', roomId: 'persist-room-alpha' }
    });
    roomAlphaId = r1.data.data.roomId;

    const r2 = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Persistent Room Beta', access: 'public', roomId: 'persist-room-beta' }
    });
    roomBetaId = r2.data.data.roomId;
  });

  after(async () => {
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

  describe('1. Database-Backed Create, Update, Delete Persistence', () => {
    let aliceSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      await new Promise((res) => {
        aliceSocket.on('connect', res);
        aliceSocket.connect();
      });
      await new Promise((res) => aliceSocket.emit('join-room', { roomId: roomAlphaId }, res));
    });

    it('should persist drawn element to MongoDB CanvasElement collection', async () => {
      const ack = await new Promise((res) =>
        aliceSocket.emit(
          'draw-element',
          {
            id: 'mongo-rect-1',
            type: 'rectangle',
            x: 100,
            y: 120,
            width: 200,
            height: 150,
            fillColor: '#6366f1'
          },
          res
        )
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'mongo-rect-1');

      // Verify physical document existence in MongoDB
      const dbDoc = await CanvasElement.findOne({ roomId: roomAlphaId, elementId: 'mongo-rect-1' });
      assert.ok(dbDoc, 'Document must be physically present in MongoDB');
      assert.strictEqual(dbDoc.roomId, roomAlphaId);
      assert.strictEqual(dbDoc.elementId, 'mongo-rect-1');
      assert.strictEqual(dbDoc.type, 'rectangle');
      assert.strictEqual(dbDoc.width, 200);
      assert.strictEqual(dbDoc.height, 150);
      assert.strictEqual(dbDoc.fillColor, '#6366f1');
      assert.strictEqual(dbDoc.version, 1);
      assert.strictEqual(dbDoc.createdBy, aliceId);
      assert.ok(dbDoc.createdAt instanceof Date);
      assert.ok(dbDoc.updatedAt instanceof Date);
    });

    it('should atomically update persisted element in MongoDB and bump version', async () => {
      const ack = await new Promise((res) =>
        aliceSocket.emit(
          'update-element',
          {
            id: 'mongo-rect-1',
            width: 350,
            fillColor: '#10b981'
          },
          res
        )
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.version, 2);
      assert.strictEqual(ack.data.width, 350);

      // Verify update in MongoDB
      const dbDoc = await CanvasElement.findOne({ roomId: roomAlphaId, elementId: 'mongo-rect-1' });
      assert.strictEqual(dbDoc.version, 2);
      assert.strictEqual(dbDoc.width, 350);
      assert.strictEqual(dbDoc.fillColor, '#10b981');
      assert.strictEqual(dbDoc.updatedBy, aliceId);
    });

    it('should delete element from MongoDB CanvasElement collection', async () => {
      const ack = await new Promise((res) =>
        aliceSocket.emit('delete-element', { id: 'mongo-rect-1' }, res)
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'mongo-rect-1');

      // Verify element was physically removed from MongoDB
      const dbDoc = await CanvasElement.findOne({ roomId: roomAlphaId, elementId: 'mongo-rect-1' });
      assert.strictEqual(dbDoc, null, 'Document must be deleted from MongoDB');
    });
  });

  describe('2. Room Scoping & Compound Unique Index', () => {
    let aliceSocket;
    let bobSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      bobSocket = createClientSocket(bobToken);

      await Promise.all([
        new Promise((res) => {
          aliceSocket.on('connect', res);
          aliceSocket.connect();
        }),
        new Promise((res) => {
          bobSocket.on('connect', res);
          bobSocket.connect();
        })
      ]);

      // Alice joins Room Alpha, Bob joins Room Beta
      await new Promise((res) => aliceSocket.emit('join-room', { roomId: roomAlphaId }, res));
      await new Promise((res) => bobSocket.emit('join-room', { roomId: roomBetaId }, res));
    });

    it('should permit the same elementId in DIFFERENT rooms without unique constraint violation', async () => {
      // Alice creates 'shared-id-1' in Room Alpha
      const ackAlpha = await new Promise((res) =>
        aliceSocket.emit(
          'draw-element',
          {
            id: 'shared-id-1',
            type: 'circle',
            x: 50,
            y: 50,
            radius: 25
          },
          res
        )
      );
      assert.strictEqual(ackAlpha.status, 'success');

      // Bob creates 'shared-id-1' in Room Beta
      const ackBeta = await new Promise((res) =>
        bobSocket.emit(
          'draw-element',
          {
            id: 'shared-id-1',
            type: 'text',
            x: 100,
            y: 100,
            text: 'I am in Beta'
          },
          res
        )
      );
      assert.strictEqual(ackBeta.status, 'success');

      // Verify both documents exist in MongoDB independently
      const docAlpha = await CanvasElement.findOne({ roomId: roomAlphaId, elementId: 'shared-id-1' });
      const docBeta = await CanvasElement.findOne({ roomId: roomBetaId, elementId: 'shared-id-1' });

      assert.ok(docAlpha && docBeta);
      assert.strictEqual(docAlpha.type, 'circle');
      assert.strictEqual(docBeta.type, 'text');
    });

    it('should reject duplicate elementId within the SAME room via MongoDB duplicate-key constraint', async () => {
      // Alice tries to draw 'shared-id-1' again in Room Alpha
      const ackDup = await new Promise((res) =>
        aliceSocket.emit(
          'draw-element',
          {
            id: 'shared-id-1',
            type: 'rectangle',
            x: 10,
            y: 10,
            width: 20,
            height: 20
          },
          res
        )
      );

      assert.strictEqual(ackDup.status, 'error');
      assert.match(ackDup.message, /already exists/i);
    });
  });

  describe('3. Late Joiners & Server Restart Recovery Simulation', () => {
    it('should restore persisted canvas elements from MongoDB when joining room on clean connection', async () => {
      // Draw elements into Room Alpha
      await canvasService.addElement(
        roomAlphaId,
        {
          id: 'restart-test-rect',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 80,
          height: 60
        },
        aliceId
      );

      // Verify simulated server restart: fetch elements via clean query
      const elementsInDb = await canvasService.getElements(roomAlphaId);
      assert.ok(elementsInDb.some((el) => el.id === 'restart-test-rect'));

      // New client connects and joins Room Alpha
      const newClient = createClientSocket(bobToken);
      await new Promise((res) => {
        newClient.on('connect', res);
        newClient.connect();
      });

      const joinAck = await new Promise((res) =>
        newClient.emit('join-room', { roomId: roomAlphaId }, res)
      );

      assert.strictEqual(joinAck.status, 'success');
      const elementIds = joinAck.data.canvasState.map((el) => el.id);
      assert.ok(elementIds.includes('shared-id-1'));
      assert.ok(elementIds.includes('restart-test-rect'));
    });
  });

  describe('4. Concurrency & Optimistic Stale-Version Conflict Handling', () => {
    let aliceSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      await new Promise((res) => {
        aliceSocket.on('connect', res);
        aliceSocket.connect();
      });
      await new Promise((res) => aliceSocket.emit('join-room', { roomId: roomAlphaId }, res));
    });

    it('should reject stale update when expectedVersion does not match current version', async () => {
      // 'restart-test-rect' is currently version 1. Stale client sends expectedVersion: 0 or expectedVersion: 99
      const conflictAck = await new Promise((res) =>
        aliceSocket.emit(
          'update-element',
          {
            id: 'restart-test-rect',
            width: 120,
            expectedVersion: 99 // Conflict! Current is 1
          },
          res
        )
      );

      assert.strictEqual(conflictAck.status, 'error');
      assert.match(conflictAck.message, /version conflict/i);
    });

    it('should accept update when expectedVersion matches current version and increment version', async () => {
      const successAck = await new Promise((res) =>
        aliceSocket.emit(
          'update-element',
          {
            id: 'restart-test-rect',
            width: 120,
            expectedVersion: 1
          },
          res
        )
      );

      assert.strictEqual(successAck.status, 'success');
      assert.strictEqual(successAck.data.version, 2);
      assert.strictEqual(successAck.data.width, 120);
    });
  });

  describe('5. Database Failure Isolation & No Broadcast on Error', () => {
    let aliceSocket;
    let bobSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      bobSocket = createClientSocket(bobToken);

      await Promise.all([
        new Promise((res) => {
          aliceSocket.on('connect', res);
          aliceSocket.connect();
        }),
        new Promise((res) => {
          bobSocket.on('connect', res);
          bobSocket.connect();
        })
      ]);

      await new Promise((res) => aliceSocket.emit('join-room', { roomId: roomAlphaId }, res));
      await new Promise((res) => bobSocket.emit('join-room', { roomId: roomAlphaId }, res));
    });

    it('should not broadcast to peers when a draw operation fails due to validation or DB error', async () => {
      let bobReceivedBroadcast = false;
      bobSocket.on('canvas-operation', () => {
        bobReceivedBroadcast = true;
      });

      // Alice sends invalid payload (NaN coordinate)
      const ack = await new Promise((res) =>
        aliceSocket.emit(
          'draw-element',
          {
            id: 'fail-rect',
            type: 'rectangle',
            x: NaN,
            y: 0,
            width: 10,
            height: 10
          },
          res
        )
      );

      assert.strictEqual(ack.status, 'error');

      // Wait to ensure no broadcast is emitted
      await new Promise((res) => setTimeout(res, 50));
      assert.strictEqual(bobReceivedBroadcast, false, 'Failed operations must never be broadcast to peers');
    });

    it('should not broadcast to peers when an update fails due to nonexistent element', async () => {
      let bobReceivedBroadcast = false;
      bobSocket.on('canvas-operation', () => {
        bobReceivedBroadcast = true;
      });

      const ack = await new Promise((res) =>
        aliceSocket.emit('update-element', { id: 'nonexistent-ghost-1', width: 50 }, res)
      );

      assert.strictEqual(ack.status, 'error');

      await new Promise((res) => setTimeout(res, 50));
      assert.strictEqual(bobReceivedBroadcast, false);
    });
  });

  describe('6. Regression: REST APIs and Health', () => {
    it('should preserve GET /api/health', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
    });

    it('should preserve REST room retrieval', async () => {
      const res = await request('GET', `/api/rooms/${roomAlphaId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.roomId, roomAlphaId);
    });
  });
});
