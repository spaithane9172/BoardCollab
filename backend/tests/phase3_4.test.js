const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

// Test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_race_34';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p34';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');

describe('Phase 3.4: Concurrent Editing and Conflict Safety Tests', () => {
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

  let roomId;

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
      body: { name: 'Alice Race', email: 'alice_race@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob Race', email: 'bob_race@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id;

    const resCharlie = await request('POST', '/api/auth/register', {
      body: { name: 'Charlie Race', email: 'charlie_race@example.com', password: 'Password123!' }
    });
    charlieToken = resCharlie.data.data.token;
    charlieId = resCharlie.data.data.user._id;

    // Create room
    const r = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Concurrency Testing Room', access: 'public', roomId: 'race-testing-room' }
    });
    roomId = r.data.data.roomId;
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

  describe('1. Simultaneous Competing Updates with Same expectedVersion', () => {
    let aliceSocket;
    let bobSocket;
    let charlieSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      bobSocket = createClientSocket(bobToken);
      charlieSocket = createClientSocket(charlieToken);

      await Promise.all([
        new Promise((res) => { aliceSocket.on('connect', res); aliceSocket.connect(); }),
        new Promise((res) => { bobSocket.on('connect', res); bobSocket.connect(); }),
        new Promise((res) => { charlieSocket.on('connect', res); charlieSocket.connect(); })
      ]);

      await Promise.all([
        new Promise((res) => aliceSocket.emit('join-room', { roomId }, res)),
        new Promise((res) => bobSocket.emit('join-room', { roomId }, res)),
        new Promise((res) => charlieSocket.emit('join-room', { roomId }, res))
      ]);

      // Seed element with initial version 1
      await canvasService.addElement(
        roomId,
        {
          id: 'simultaneous-rect-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 100,
          height: 80,
          fillColor: '#initial'
        },
        aliceId
      );
    });

    it('should converge concurrent updates deterministically without data corruption or rejection', async () => {
      const charlieReceivedOps = [];
      charlieSocket.on('canvas-operation', (op) => {
        if (op.element && op.element.id === 'simultaneous-rect-1') {
          charlieReceivedOps.push(op);
        }
      });

      // Alice proposes width: 200, Bob proposes width: 300, both with expectedVersion: 1
      const aliceUpdatePromise = new Promise((resolve) =>
        aliceSocket.emit(
          'update-element',
          { id: 'simultaneous-rect-1', width: 200, fillColor: '#alice', expectedVersion: 1 },
          resolve
        )
      );

      const bobUpdatePromise = new Promise((resolve) =>
        bobSocket.emit(
          'update-element',
          { id: 'simultaneous-rect-1', width: 300, fillColor: '#bob', expectedVersion: 1 },
          resolve
        )
      );

      // Fire both simultaneously over WebSocket connections
      const [aliceAck, bobAck] = await Promise.all([aliceUpdatePromise, bobUpdatePromise]);

      const successCount = (aliceAck.status === 'success' ? 1 : 0) + (bobAck.status === 'success' ? 1 : 0);
      assert.strictEqual(successCount, 2, 'Both concurrent updates succeed under CRDT without 409 rejection');

      // Stored MongoDB document version matches converged state
      const dbDoc = await CanvasElement.findOne({ roomId, elementId: 'simultaneous-rect-1' });
      assert.ok(dbDoc.version >= 2, 'Authoritative version must increment');
      assert.ok(dbDoc.width === 200 || dbDoc.width === 300, 'Width converges deterministically');
      assert.ok(dbDoc.fillColor === '#alice' || dbDoc.fillColor === '#bob', 'Color converges deterministically');

      // Wait a tick to confirm broadcasts
      await new Promise((res) => setTimeout(res, 50));

      // Invariant: Charlie received operations without errors
      assert.ok(charlieReceivedOps.length >= 1, 'Charlie received broadcast operations');
    });
  });

  describe('2. Concurrent Duplicate Creates', () => {
    let aliceSocket;
    let bobSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      bobSocket = createClientSocket(bobToken);

      await Promise.all([
        new Promise((res) => { aliceSocket.on('connect', res); aliceSocket.connect(); }),
        new Promise((res) => { bobSocket.on('connect', res); bobSocket.connect(); })
      ]);

      await Promise.all([
        new Promise((res) => aliceSocket.emit('join-room', { roomId }, res)),
        new Promise((res) => bobSocket.emit('join-room', { roomId }, res))
      ]);
    });

    it('should atomically allow only one create to succeed when both use same element ID', async () => {
      const aliceCreatePromise = new Promise((resolve) =>
        aliceSocket.emit(
          'draw-element',
          { id: 'race-create-rect', type: 'rectangle', x: 10, y: 10, width: 50, height: 50 },
          resolve
        )
      );

      const bobCreatePromise = new Promise((resolve) =>
        bobSocket.emit(
          'draw-element',
          { id: 'race-create-rect', type: 'rectangle', x: 20, y: 20, width: 60, height: 60 },
          resolve
        )
      );

      const [aliceAck, bobAck] = await Promise.all([aliceCreatePromise, bobCreatePromise]);

      const successCount = (aliceAck.status === 'success' ? 1 : 0) + (bobAck.status === 'success' ? 1 : 0);
      const errorCount = (aliceAck.status === 'error' ? 1 : 0) + (bobAck.status === 'error' ? 1 : 0);

      assert.strictEqual(successCount, 1);
      assert.strictEqual(errorCount, 1);

      const errorAck = aliceAck.status === 'error' ? aliceAck : bobAck;
      assert.match(errorAck.message, /already exists/i);

      // Exactly one document stored in MongoDB
      const count = await CanvasElement.countDocuments({ roomId, elementId: 'race-create-rect' });
      assert.strictEqual(count, 1);
    });
  });

  describe('3. Concurrent Update Racing with Delete', () => {
    let aliceSocket;
    let bobSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      bobSocket = createClientSocket(bobToken);

      await Promise.all([
        new Promise((res) => { aliceSocket.on('connect', res); aliceSocket.connect(); }),
        new Promise((res) => { bobSocket.on('connect', res); bobSocket.connect(); })
      ]);

      await Promise.all([
        new Promise((res) => aliceSocket.emit('join-room', { roomId }, res)),
        new Promise((res) => bobSocket.emit('join-room', { roomId }, res))
      ]);
    });

    it('should never recreate a deleted element when update races with delete', async () => {
      // Create element to delete/update
      await canvasService.addElement(
        roomId,
        {
          id: 'race-del-rect',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50
        },
        aliceId
      );

      // Alice deletes, Bob updates
      const deletePromise = new Promise((resolve) =>
        aliceSocket.emit('delete-element', { id: 'race-del-rect' }, resolve)
      );

      const updatePromise = new Promise((resolve) =>
        bobSocket.emit('update-element', { id: 'race-del-rect', width: 999 }, resolve)
      );

      const [delAck, updateAck] = await Promise.all([deletePromise, updatePromise]);

      // If delete ran first, update returns 404 error
      // If update ran first, update succeeds, delete follows and deletes it
      // In either scenario: The final state MUST NOT have 'race-del-rect' resurrected!
      assert.strictEqual(delAck.status, 'success');

      // Final check in MongoDB: Element MUST be deleted
      const doc = await CanvasElement.findOne({ roomId, elementId: 'race-del-rect' });
      assert.strictEqual(doc, null, 'Deleted element must not be resurrected');
    });
  });

  describe('4. Backward Compatibility: Clients Omission of expectedVersion', () => {
    let aliceSocket;

    before(async () => {
      aliceSocket = createClientSocket(aliceToken);
      await new Promise((res) => { aliceSocket.on('connect', res); aliceSocket.connect(); });
      await new Promise((res) => aliceSocket.emit('join-room', { roomId }, res));
    });

    it('should successfully update and increment version when expectedVersion is omitted', async () => {
      await canvasService.addElement(
        roomId,
        {
          id: 'no-expected-ver-rect',
          type: 'rectangle',
          x: 10,
          y: 10,
          width: 50,
          height: 50
        },
        aliceId
      );

      // Client omits expectedVersion
      const ack1 = await new Promise((res) =>
        aliceSocket.emit('update-element', { id: 'no-expected-ver-rect', width: 75 }, res)
      );
      assert.strictEqual(ack1.status, 'success');
      assert.strictEqual(ack1.data.version, 2);

      // Second update without expectedVersion
      const ack2 = await new Promise((res) =>
        aliceSocket.emit('update-element', { id: 'no-expected-ver-rect', width: 90 }, res)
      );
      assert.strictEqual(ack2.status, 'success');
      assert.strictEqual(ack2.data.version, 3);
    });
  });
});
