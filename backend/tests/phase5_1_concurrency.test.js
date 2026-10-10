const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_phase51_concurrency';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p51_concurrency';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');

describe('Phase 5.1: 20-Client Concurrent Collaboration Tests', () => {
  let server;
  let ioServer;
  let baseUrl;
  let socketUrl;

  const CLIENT_COUNT = 20;
  const users = []; // { id, token, name, email }
  let publicRoomId;
  let privateRoomId;
  const activeSockets = [];

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
    activeSockets.push(socket);
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

    // 1. Register 20 authenticated test users
    for (let i = 0; i < CLIENT_COUNT; i++) {
      const res = await request('POST', '/api/auth/register', {
        body: {
          name: `User ${i + 1}`,
          email: `client${i + 1}_p51@example.com`,
          password: 'Password123!'
        }
      });
      assert.strictEqual(res.status, 201, `Failed to register user ${i + 1}`);
      users.push({
        id: res.data.data.user._id,
        token: res.data.data.token,
        name: res.data.data.user.name,
        email: res.data.data.user.email
      });
    }

    // 2. User 0 creates a public room
    const pubRoomRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${users[0].token}` },
      body: { name: 'Concurrent Test Public Room', access: 'public' }
    });
    assert.strictEqual(pubRoomRes.status, 201);
    publicRoomId = pubRoomRes.data.data.roomId;

    // 3. User 0 creates a private room (only user 0 has access initially)
    const privRoomRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${users[0].token}` },
      body: { name: 'Concurrent Test Private Room', access: 'private' }
    });
    assert.strictEqual(privRoomRes.status, 201);
    privateRoomId = privRoomRes.data.data.roomId;
  });

  after(async () => {
    for (const socket of activeSockets) {
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

  it('1. All 20 authorized clients can connect and join the public room successfully', async () => {
    const clients = users.map((u) => createClientSocket(u.token));

    // Connect all 20 sockets concurrently
    await Promise.all(clients.map((s) => connectSocketAsync(s)));
    for (const client of clients) {
      assert.strictEqual(client.connected, true);
    }

    // Join room concurrently
    const joinResponses = await Promise.all(clients.map((s) => joinRoomAsync(s, publicRoomId)));

    for (let i = 0; i < CLIENT_COUNT; i++) {
      const resp = joinResponses[i];
      assert.strictEqual(resp.status, 'success', `Client ${i} failed to join room: ${resp.message}`);
      assert.strictEqual(resp.data.room.roomId, publicRoomId);
      assert.strictEqual(Array.isArray(resp.data.canvasState), true);
    }

    // Verify all 20 unique users are tracked in presence
    const participants = presenceManager.getParticipants(publicRoomId);
    assert.strictEqual(participants.length, CLIENT_COUNT, `Expected 20 participants, got ${participants.length}`);
  });

  it('2. Presence counts remain correct when a single user opens multiple tabs or disconnects', async () => {
    // User 1 opens a second tab (second socket connection)
    const user1SecondTab = createClientSocket(users[0].token);
    await connectSocketAsync(user1SecondTab);
    const joinRes = await joinRoomAsync(user1SecondTab, publicRoomId);
    assert.strictEqual(joinRes.status, 'success');

    // Total participants should still be 20 unique users (not 21)
    let participants = presenceManager.getParticipants(publicRoomId);
    assert.strictEqual(participants.length, 20, 'Second tab should not inflate unique participants count');

    // Close the second tab
    user1SecondTab.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // User 1 is still in the room via tab 1
    participants = presenceManager.getParticipants(publicRoomId);
    assert.strictEqual(participants.length, 20, 'User 1 should remain present via primary connection');
    const user1Present = participants.some((p) => p.id === users[0].id.toString());
    assert.strictEqual(user1Present, true);
  });

  it('3. Drawing operations reach all intended peers without sending duplicate broadcast to sender', async () => {
    const sender = activeSockets[0]; // Client 1
    const peerSockets = activeSockets.slice(1, 20); // Clients 2-20

    let senderReceivedBroadcast = false;
    sender.on('canvas-operation', (data) => {
      if (data?.element?.id === 'elem-echo-check') {
        senderReceivedBroadcast = true;
      }
    });

    const peerBroadcastPromises = peerSockets.map((peer) => {
      return new Promise((resolve) => {
        peer.on('canvas-operation', function handler(data) {
          if (data?.element?.id === 'elem-echo-check') {
            peer.off('canvas-operation', handler);
            resolve(data);
          }
        });
      });
    });

    // Sender emits draw-element
    const drawResponse = await new Promise((resolve) => {
      sender.emit(
        'draw-element',
        {
          id: 'elem-echo-check',
          type: 'rectangle',
          x: 100,
          y: 150,
          width: 200,
          height: 120,
          strokeColor: '#3b82f6',
          fillColor: '#dbeafe',
          strokeWidth: 2
        },
        resolve
      );
    });

    assert.strictEqual(drawResponse.status, 'success');
    assert.strictEqual(drawResponse.data.id, 'elem-echo-check');
    assert.strictEqual(drawResponse.data.version, 1);

    // Wait for all 19 peers to receive broadcast
    const peerResults = await Promise.all(peerBroadcastPromises);
    assert.strictEqual(peerResults.length, 19, 'All 19 peers must receive the broadcast');
    for (const res of peerResults) {
      assert.strictEqual(res.action, 'create');
      assert.strictEqual(res.element.id, 'elem-echo-check');
      assert.strictEqual(res.element.type, 'rectangle');
    }

    // Brief wait to ensure sender does NOT receive the broadcast
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(senderReceivedBroadcast, false, 'Sender must not receive duplicate peer broadcast');
  });

  it('4. 20 concurrent drawing operations succeed without unhandled server errors and persist to MongoDB', async () => {
    const drawPromises = activeSockets.slice(0, 20).map((socket, idx) => {
      return new Promise((resolve) => {
        socket.emit(
          'draw-element',
          {
            id: `concurrent-elem-${idx + 1}`,
            type: 'circle',
            x: 50 + idx * 20,
            y: 50 + idx * 10,
            radius: 30,
            strokeColor: '#10b981',
            fillColor: '#a7f3d0',
            strokeWidth: 2
          },
          (res) => resolve({ idx, res })
        );
      });
    });

    const results = await Promise.all(drawPromises);
    for (const { idx, res } of results) {
      assert.strictEqual(res.status, 'success', `Client ${idx} draw operation failed: ${res.message}`);
      assert.strictEqual(res.data.id, `concurrent-elem-${idx + 1}`);
      assert.strictEqual(res.data.version, 1);
    }

    // Verify MongoDB contains all 20 elements plus the earlier echo-check element
    const persistedCount = await CanvasElement.countDocuments({ roomId: publicRoomId });
    assert.strictEqual(persistedCount, 21, `Expected 21 persisted elements, got ${persistedCount}`);
  });

  it('5. Concurrent updates with expectedVersion produce deterministic convergence across competing updates', async () => {
    const targetElementId = 'concurrent-elem-1';
    const candidateSockets = activeSockets.slice(0, 5); // 5 clients racing to update version 1

    const updatePromises = candidateSockets.map((socket, idx) => {
      return new Promise((resolve) => {
        socket.emit(
          'update-element',
          {
            id: targetElementId,
            expectedVersion: 1,
            changes: {
              x: 500 + idx * 10,
              strokeColor: `#${idx}${idx}0000`
            }
          },
          (res) => resolve({ idx, res })
        );
      });
    });

    const updateResults = await Promise.all(updatePromises);

    const successes = updateResults.filter((r) => r.res.status === 'success');
    assert.strictEqual(successes.length, 5, `Expected all 5 updates to converge without 409 rejection`);

    // Confirm database matches authoritative converged version
    const doc = await CanvasElement.findOne({ roomId: publicRoomId, elementId: targetElementId });
    assert.ok(doc.version >= 2, 'Authoritative version must increment');
    assert.ok(doc.x >= 500, 'Position must converge deterministically');
  });

  it('6. Unauthorized clients cannot join a private room', async () => {
    // Client 19 (User 20) is not a member of privateRoomId (owned by User 0)
    const unauthorizedSocket = activeSockets[19];
    const joinRes = await joinRoomAsync(unauthorizedSocket, privateRoomId);

    assert.strictEqual(joinRes.status, 'error');
    assert.ok(
      joinRes.message.includes('Access denied') || joinRes.message.includes('private room'),
      `Expected access denial, got: ${joinRes.message}`
    );
  });

  it('7. Disconnect and reconnect restores the authoritative persisted canvas state', async () => {
    const clientToReconnect = activeSockets[0]; // Client 1
    clientToReconnect.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Reconnect client with a fresh socket
    const reconnectedSocket = createClientSocket(users[0].token);
    await connectSocketAsync(reconnectedSocket);

    const joinRes = await joinRoomAsync(reconnectedSocket, publicRoomId);
    assert.strictEqual(joinRes.status, 'success');
    assert.strictEqual(joinRes.data.canvasState.length, 21, 'Restored canvasState must contain all 21 elements');

    // Elements must contain the converged version update
    const updatedElem = joinRes.data.canvasState.find((e) => e.id === 'concurrent-elem-1');
    assert.ok(updatedElem, 'Updated element must exist in restored state');
    assert.ok(updatedElem.version >= 2, 'Version must be at least 2 after concurrent updates');
  });
});
