const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_phase51_reliability';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p51_reliability';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');

describe('Phase 5.1: Reliability and Edge Case Regression Tests', () => {
  let server;
  let ioServer;
  let baseUrl;
  let socketUrl;

  let aliceToken;
  let aliceId;
  let bobToken;
  let bobId;

  let openSockets = [];

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

  const createRoom = async (token, name = 'Test Room', access = 'public') => {
    const res = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${token}` },
      body: { name, access }
    });
    assert.strictEqual(res.status, 201);
    return res.data.data.roomId;
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
      body: { name: 'Alice Reliability', email: 'alice_rel@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id || resAlice.data.data.user.id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob Reliability', email: 'bob_rel@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id || resBob.data.data.user.id;
  });

  after(async () => {
    for (const socket of openSockets) {
      if (socket.connected) socket.disconnect();
    }
    openSockets = [];

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

  it('1. Duplicate element creation: Rejects duplicate in same room but allows same ID in different rooms', async () => {
    const testRoom1 = await createRoom(aliceToken, 'Dup Room 1');
    const testRoom2 = await createRoom(bobToken, 'Dup Room 2');

    const aliceSocket = createClientSocket(aliceToken);
    const bobSocket = createClientSocket(bobToken);
    await connectSocketAsync(aliceSocket);
    await connectSocketAsync(bobSocket);

    await joinRoomAsync(aliceSocket, testRoom1);
    await joinRoomAsync(bobSocket, testRoom2);

    const elemId = 'shared-id-across-rooms';

    // Alice creates in testRoom1
    const createRes1 = await new Promise((resolve) => {
      aliceSocket.emit(
        'draw-element',
        { id: elemId, type: 'rectangle', x: 10, y: 10, width: 100, height: 50 },
        resolve
      );
    });
    assert.strictEqual(createRes1.status, 'success');

    // Alice attempts to create identical elemId in testRoom1 again -> must fail with duplicate error
    const dupRes = await new Promise((resolve) => {
      aliceSocket.emit(
        'draw-element',
        { id: elemId, type: 'rectangle', x: 20, y: 20, width: 80, height: 40 },
        resolve
      );
    });
    assert.strictEqual(dupRes.status, 'error');
    assert.ok(dupRes.message.includes('already exists'), `Expected already exists error, got: ${dupRes.message}`);

    // Bob creates identical elemId in testRoom2 -> must succeed due to compound index { roomId, elementId }
    const createRes2 = await new Promise((resolve) => {
      bobSocket.emit(
        'draw-element',
        { id: elemId, type: 'circle', x: 50, y: 50, radius: 25 },
        resolve
      );
    });
    assert.strictEqual(createRes2.status, 'success');

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  it('2. Invalid or oversized payloads are rejected safely with structured errors', async () => {
    const testRoom = await createRoom(aliceToken, 'Payload Validation Room');
    const socket = createClientSocket(aliceToken);
    await connectSocketAsync(socket);
    await joinRoomAsync(socket, testRoom);

    // 2a. Unknown type
    const badTypeRes = await new Promise((resolve) => {
      socket.emit('draw-element', { id: 'bad-elem-1', type: 'triangle', x: 0, y: 0 }, resolve);
    });
    assert.strictEqual(badTypeRes.status, 'error');
    assert.ok(badTypeRes.message.includes('Element type must be one of'));

    // 2b. Malformed ID (invalid symbols)
    const badIdRes = await new Promise((resolve) => {
      socket.emit('draw-element', { id: 'invalid id with spaces!@#', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }, resolve);
    });
    assert.strictEqual(badIdRes.status, 'error');
    assert.ok(badIdRes.message.includes('Element id must be a string'));

    // 2c. Oversized stroke points array (> 2000 points)
    const oversizedPoints = Array.from({ length: 2005 }, (_, i) => ({ x: i, y: i }));
    const badPointsRes = await new Promise((resolve) => {
      socket.emit('draw-element', { id: 'oversized-stroke', type: 'stroke', points: oversizedPoints }, resolve);
    });
    assert.strictEqual(badPointsRes.status, 'error');
    assert.ok(badPointsRes.message.includes('exceeds maximum length of 2000'));

    // 2d. Oversized text (> 1000 characters)
    const oversizedText = 'A'.repeat(1005);
    const badTextRes = await new Promise((resolve) => {
      socket.emit('draw-element', { id: 'oversized-text', type: 'text', text: oversizedText, x: 10, y: 10 }, resolve);
    });
    assert.strictEqual(badTextRes.status, 'error');
    assert.ok(badTextRes.message.includes('characters'));

    // 2e. Negative dimensions
    const negativeDimRes = await new Promise((resolve) => {
      socket.emit('draw-element', { id: 'bad-dim', type: 'rectangle', x: 10, y: 10, width: -50, height: 100 }, resolve);
    });
    assert.strictEqual(negativeDimRes.status, 'error');
    assert.ok(negativeDimRes.message.includes('between 0 and'));

    socket.disconnect();
  });

  it('3. Simultaneous update and delete operations handle concurrency gracefully without crashes', async () => {
    const testRoom = await createRoom(aliceToken, 'Race Update Delete Room');
    const socketA = createClientSocket(aliceToken);
    const socketB = createClientSocket(bobToken);
    await connectSocketAsync(socketA);
    await connectSocketAsync(socketB);
    await joinRoomAsync(socketA, testRoom);
    await joinRoomAsync(socketB, testRoom);

    const raceElemId = 'race-update-delete-target';

    // Create initial element
    const createRes = await new Promise((resolve) => {
      socketA.emit(
        'draw-element',
        { id: raceElemId, type: 'circle', x: 100, y: 100, radius: 40 },
        resolve
      );
    });
    assert.strictEqual(createRes.status, 'success');

    // Fire update from socketA and delete from socketB simultaneously
    const [updateResult, deleteResult] = await Promise.all([
      new Promise((resolve) => {
        socketA.emit('update-element', { id: raceElemId, changes: { radius: 55 } }, resolve);
      }),
      new Promise((resolve) => {
        socketB.emit('delete-element', { id: raceElemId }, resolve);
      })
    ]);

    const validOutcomes =
      (updateResult.status === 'success' && deleteResult.status === 'success') ||
      (deleteResult.status === 'success' && updateResult.status === 'error' && updateResult.message.includes('not found'));

    assert.ok(validOutcomes, `Unexpected race result: update=${JSON.stringify(updateResult)}, delete=${JSON.stringify(deleteResult)}`);

    // In either case, final state in MongoDB must NOT have the element
    const remainingDoc = await CanvasElement.findOne({ roomId: testRoom, elementId: raceElemId });
    assert.strictEqual(remainingDoc, null, 'Deleted element must not exist in MongoDB');

    socketA.disconnect();
    socketB.disconnect();
  });

  it('4. Stale expectedVersion values are rejected with 409 conflict and indicate version mismatch', async () => {
    const testRoom = await createRoom(aliceToken, 'Stale Version Room');
    const socket = createClientSocket(aliceToken);
    await connectSocketAsync(socket);
    await joinRoomAsync(socket, testRoom);

    const elemId = 'stale-version-test';
    await new Promise((resolve) => {
      socket.emit('draw-element', { id: elemId, type: 'text', text: 'Hello', x: 20, y: 20 }, resolve);
    });

    // Provide stale expectedVersion (e.g., 99 when current version is 1)
    const staleUpdateRes = await new Promise((resolve) => {
      socket.emit('update-element', { id: elemId, expectedVersion: 99, changes: { text: 'Updated' } }, resolve);
    });

    assert.strictEqual(staleUpdateRes.status, 'error');
    assert.ok(
      staleUpdateRes.message.includes('Version conflict') || staleUpdateRes.message.includes('version'),
      `Expected version conflict, got: ${staleUpdateRes.message}`
    );

    socket.disconnect();
  });

  it('5. User with multiple open tabs: Disconnecting tabs gradually maintains presence until last tab closes', async () => {
    const testRoom = await createRoom(aliceToken, 'Multi Tab Room');

    const peerSocket = createClientSocket(bobToken);
    await connectSocketAsync(peerSocket);
    await joinRoomAsync(peerSocket, testRoom);

    let peerSawUserLeft = false;
    peerSocket.on('user-left', (data) => {
      if (data?.user?.id === aliceId.toString()) {
        peerSawUserLeft = true;
      }
    });

    // Alice opens tab 1, tab 2, and tab 3
    const tab1 = createClientSocket(aliceToken);
    const tab2 = createClientSocket(aliceToken);
    const tab3 = createClientSocket(aliceToken);

    await connectSocketAsync(tab1);
    await connectSocketAsync(tab2);
    await connectSocketAsync(tab3);

    await joinRoomAsync(tab1, testRoom);
    await joinRoomAsync(tab2, testRoom);
    await joinRoomAsync(tab3, testRoom);

    // Tab 1 closes
    tab1.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(peerSawUserLeft, false, 'Bob should not receive user-left while Alice has other open tabs');

    // Tab 2 closes
    tab2.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(peerSawUserLeft, false, 'Bob should not receive user-left while Alice has tab 3 open');

    // Tab 3 closes (all of Alice tabs closed)
    tab3.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(peerSawUserLeft, true, 'Bob must receive user-left when Alice last tab disconnects');

    peerSocket.disconnect();
  });

  it('6. Controlled server restart persistence: Canvas state survives full server shutdown and restart', async () => {
    const testRoom = await createRoom(aliceToken, 'Server Restart Room');

    const clientBefore = createClientSocket(aliceToken);
    await connectSocketAsync(clientBefore);
    await joinRoomAsync(clientBefore, testRoom);

    // Draw 3 elements
    for (let i = 1; i <= 3; i++) {
      await new Promise((resolve) => {
        clientBefore.emit(
          'draw-element',
          { id: `persist-test-${i}`, type: 'rectangle', x: i * 30, y: i * 30, width: 50, height: 50 },
          resolve
        );
      });
    }

    clientBefore.disconnect();

    // Stop current HTTP server and ioServer completely
    await new Promise((resolve) => ioServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    presenceManager.clear();

    // Start a completely new HTTP server and Socket.IO instance on a new port
    const newServer = http.createServer(app);
    const newIoServer = initSocketIO(newServer);
    await new Promise((resolve) => newServer.listen(0, resolve));
    const newPort = newServer.address().port;
    const newSocketUrl = `http://localhost:${newPort}`;

    // Connect fresh client to the restarted server
    const clientAfter = Client(newSocketUrl, {
      auth: { token: aliceToken },
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('clientAfter connect timeout')), 4000);
      clientAfter.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      clientAfter.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const joinRes = await new Promise((resolve) => {
      clientAfter.emit('join-room', { roomId: testRoom }, resolve);
    });

    assert.strictEqual(joinRes.status, 'success');
    assert.ok(Array.isArray(joinRes.data.canvasState));

    // Check that all 3 elements were preserved in MongoDB across the server restart
    const persistedIds = joinRes.data.canvasState.map((e) => e.id);
    assert.ok(persistedIds.includes('persist-test-1'));
    assert.ok(persistedIds.includes('persist-test-2'));
    assert.ok(persistedIds.includes('persist-test-3'));

    // Clean up restarted server
    clientAfter.disconnect();
    await new Promise((resolve) => newIoServer.close(resolve));
    await new Promise((resolve) => newServer.close(resolve));

    // Reset ioServer and server references so global after() doesn't fail
    ioServer = null;
    server = null;
  });
});
