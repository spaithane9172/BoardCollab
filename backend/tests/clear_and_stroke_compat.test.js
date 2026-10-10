const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_clear_stroke';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_clear_stroke';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');

describe('Clear Canvas & draw-stroke Compatibility Tests', () => {
  let server;
  let ioServer;
  let baseUrl;
  let socketUrl;

  let aliceToken;
  let aliceId;
  let bobToken;
  let bobId;

  let room1Id;
  let room2Id;

  const openSockets = [];

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

  const connectSocketAsync = (socket) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 4000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.connect();
    });
  };

  const joinRoomAsync = (socket, roomId) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('join-room timeout')), 4000);
      socket.emit('join-room', { roomId }, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
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

    // Create users
    const resAlice = await request('POST', '/api/auth/register', {
      body: { name: 'Alice Clear', email: 'alice_clear@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id || resAlice.data.data.user.id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob Clear', email: 'bob_clear@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id || resBob.data.data.user.id;

    // Create rooms
    const r1 = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Clear Canvas Room 1', access: 'public' }
    });
    room1Id = r1.data.data.roomId;

    const r2 = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${bobToken}` },
      body: { name: 'Clear Canvas Room 2', access: 'public' }
    });
    room2Id = r2.data.data.roomId;
  });

  after(async () => {
    for (const socket of openSockets) {
      if (socket.connected) socket.disconnect();
    }
    if (ioServer) {
      await new Promise((resolve) => ioServer.close(resolve));
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await User.deleteMany({});
    await Room.deleteMany({});
    await CanvasElement.deleteMany({});
    presenceManager.clear();
    await mongoose.disconnect();
  });

  it('1. draw-stroke alias: Emitting draw-stroke defaults type to stroke and persists properly', async () => {
    const socket = createClientSocket(aliceToken);
    await connectSocketAsync(socket);
    await joinRoomAsync(socket, room1Id);

    const drawRes = await new Promise((resolve) => {
      socket.emit(
        'draw-stroke',
        {
          id: 'stroke-alias-1',
          // type omitted intentionally to test backward-compatibility defaulting
          points: [10, 10, 20, 20, 30, 30],
          strokeColor: '#ef4444',
          strokeWidth: 4
        },
        resolve
      );
    });

    assert.strictEqual(drawRes.status, 'success');
    assert.strictEqual(drawRes.data.id, 'stroke-alias-1');
    assert.strictEqual(drawRes.data.type, 'stroke');
    assert.strictEqual(drawRes.data.strokeColor, '#ef4444');

    // Confirm persisted in MongoDB
    const doc = await CanvasElement.findOne({ roomId: room1Id, elementId: 'stroke-alias-1' });
    assert.ok(doc);
    assert.strictEqual(doc.type, 'stroke');

    socket.disconnect();
  });

  it('2. Clear Canvas Authorization: Rejects clear-canvas if socket has not joined a room', async () => {
    const unjoinedSocket = createClientSocket(aliceToken);
    await connectSocketAsync(unjoinedSocket);

    const clearRes = await new Promise((resolve) => {
      unjoinedSocket.emit('clear-canvas', resolve);
    });

    assert.strictEqual(clearRes.status, 'error');
    assert.ok(clearRes.message.includes('must join a room'));

    unjoinedSocket.disconnect();
  });

  it('3. Clear Canvas Persistence & Room Isolation: Clears elements in target room without affecting other rooms', async () => {
    const socket1 = createClientSocket(aliceToken);
    const socket2 = createClientSocket(bobToken);
    await connectSocketAsync(socket1);
    await connectSocketAsync(socket2);
    await joinRoomAsync(socket1, room1Id);
    await joinRoomAsync(socket2, room2Id);

    // Seed elements in room 1 and room 2
    await new Promise((resolve) => {
      socket1.emit(
        'draw-element',
        { id: 'elem-room1-1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50 },
        resolve
      );
    });
    await new Promise((resolve) => {
      socket2.emit(
        'draw-element',
        { id: 'elem-room2-1', type: 'circle', x: 20, y: 20, radius: 30 },
        resolve
      );
    });

    // Clear room 1
    const clearRes = await new Promise((resolve) => {
      socket1.emit('clear-canvas', resolve);
    });
    assert.strictEqual(clearRes.status, 'success');

    // Room 1 should now have 0 elements in MongoDB
    const room1Count = await CanvasElement.countDocuments({ roomId: room1Id });
    assert.strictEqual(room1Count, 0, 'Room 1 must have 0 elements after clear');

    // Room 2 should still retain its element intact
    const room2Count = await CanvasElement.countDocuments({ roomId: room2Id });
    assert.strictEqual(room2Count, 1, 'Room 2 elements must remain unaffected');

    socket1.disconnect();
    socket2.disconnect();
  });

  it('4. Collaboration Broadcast & Echo Suppression: Peer receives clear broadcast, sender does not', async () => {
    const aliceSocket = createClientSocket(aliceToken);
    const bobSocket = createClientSocket(bobToken);
    await connectSocketAsync(aliceSocket);
    await connectSocketAsync(bobSocket);
    await joinRoomAsync(aliceSocket, room1Id);
    await joinRoomAsync(bobSocket, room1Id);

    // Seed an element first
    await new Promise((resolve) => {
      aliceSocket.emit(
        'draw-element',
        { id: 'elem-before-clear', type: 'rectangle', x: 15, y: 15, width: 40, height: 40 },
        resolve
      );
    });

    let aliceReceivedBroadcast = false;
    aliceSocket.on('canvas-operation', (data) => {
      if (data?.action === 'clear') {
        aliceReceivedBroadcast = true;
      }
    });

    const bobPromise = new Promise((resolve) => {
      bobSocket.on('canvas-operation', function handler(data) {
        if (data?.action === 'clear') {
          bobSocket.off('canvas-operation', handler);
          resolve(data);
        }
      });
    });

    // Alice clears canvas
    const clearAck = await new Promise((resolve) => {
      aliceSocket.emit('clear-canvas', resolve);
    });
    assert.strictEqual(clearAck.status, 'success');

    // Bob receives clear operation broadcast
    const bobReceived = await bobPromise;
    assert.strictEqual(bobReceived.action, 'clear');
    assert.strictEqual(bobReceived.roomId, room1Id);

    // Wait to verify Alice does not receive duplicate broadcast
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(aliceReceivedBroadcast, false, 'Sender must not receive duplicate peer broadcast');

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  it('5. Reconnect Recovery: Client reconnecting after clear receives empty canvasState', async () => {
    const client = createClientSocket(aliceToken);
    await connectSocketAsync(client);
    const joinRes = await joinRoomAsync(client, room1Id);

    assert.strictEqual(joinRes.status, 'success');
    assert.strictEqual(Array.isArray(joinRes.data.canvasState), true);
    assert.strictEqual(joinRes.data.canvasState.length, 0, 'Reconnected client must receive empty canvas state');

    client.disconnect();
  });
});
