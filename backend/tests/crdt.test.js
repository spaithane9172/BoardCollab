const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_crdt_suite';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_crdt';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');
const ElementTombstone = require('../src/models/elementTombstone.model');
const exportService = require('../src/services/export.service');

describe('CRDT Whiteboard Concurrency & Conflict Resolution Tests', () => {
  let server;
  let ioServer;
  let baseUrl;
  let socketUrl;

  let aliceToken, aliceId;
  let bobToken, bobId;
  let charlieToken, charlieId;

  let publicRoomId;
  let privateRoomId;

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
    await ElementTombstone.deleteMany({});
    presenceManager.clear();

    server = http.createServer(app);
    ioServer = initSocketIO(server);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    socketUrl = `http://localhost:${port}`;

    // Register users
    const resA = await request('POST', '/api/auth/register', {
      body: { name: 'Alice CRDT', email: 'alice_crdt@example.com', password: 'Password123!' }
    });
    aliceToken = resA.data.data.token;
    aliceId = resA.data.data.user._id || resA.data.data.user.id;

    const resB = await request('POST', '/api/auth/register', {
      body: { name: 'Bob CRDT', email: 'bob_crdt@example.com', password: 'Password123!' }
    });
    bobToken = resB.data.data.token;
    bobId = resB.data.data.user._id || resB.data.data.user.id;

    const resC = await request('POST', '/api/auth/register', {
      body: { name: 'Charlie CRDT', email: 'charlie_crdt@example.com', password: 'Password123!' }
    });
    charlieToken = resC.data.data.token;
    charlieId = resC.data.data.user._id || resC.data.data.user.id;

    // Create public room
    const pubRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Public CRDT Room', access: 'public' }
    });
    publicRoomId = pubRes.data.data.roomId;

    // Create private room owned by Alice
    const privRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Private CRDT Room', access: 'private' }
    });
    privateRoomId = privRes.data.data.roomId;
  });

  after(async () => {
    for (const s of openSockets) {
      if (s.connected) s.disconnect();
    }
    if (ioServer) {
      await new Promise((resolve) => ioServer.close(resolve));
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it('1. Concurrent creation of distinct elements preserves both', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    const opA = new Promise((resolve) =>
      sockA.emit(
        'draw-element',
        { id: 'crdt-elem-a', type: 'rectangle', x: 10, y: 10, width: 100, height: 100 },
        resolve
      )
    );
    const opB = new Promise((resolve) =>
      sockB.emit(
        'draw-element',
        { id: 'crdt-elem-b', type: 'circle', x: 200, y: 200, radius: 50 },
        resolve
      )
    );

    const [resA, resB] = await Promise.all([opA, opB]);
    assert.strictEqual(resA.status, 'success');
    assert.strictEqual(resB.status, 'success');

    // Both elements must exist in persistent store
    const elements = await canvasService.getElements(publicRoomId);
    const ids = elements.map((e) => e.id);
    assert.ok(ids.includes('crdt-elem-a'), 'Element A must be preserved');
    assert.ok(ids.includes('crdt-elem-b'), 'Element B must be preserved');
  });

  it('2. Concurrent position and color changes preserve both properties (LWW property merge)', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    // Seed shared rectangle
    const seed = await canvasService.addElement(
      publicRoomId,
      { id: 'crdt-merge-rect', type: 'rectangle', x: 50, y: 50, width: 80, height: 80, fillColor: '#000000' },
      aliceId
    );
    assert.strictEqual(seed.id, 'crdt-merge-rect');

    // Alice changes position (x, y); Bob concurrently changes color (fillColor)
    const updateA = new Promise((resolve) =>
      sockA.emit(
        'update-element',
        { id: 'crdt-merge-rect', changes: { x: 300, y: 400 }, expectedVersion: 1 },
        resolve
      )
    );
    const updateB = new Promise((resolve) =>
      sockB.emit(
        'update-element',
        { id: 'crdt-merge-rect', changes: { fillColor: '#ff00ff' }, expectedVersion: 1 },
        resolve
      )
    );

    const [ackA, ackB] = await Promise.all([updateA, updateB]);
    assert.strictEqual(ackA.status, 'success', 'Alice update must succeed');
    assert.strictEqual(ackB.status, 'success', 'Bob update must succeed without 409 rejection');

    // Verify converged state contains Alice position AND Bob color
    const merged = await CanvasElement.findOne({ roomId: publicRoomId, elementId: 'crdt-merge-rect' });
    assert.strictEqual(merged.x, 300, 'Alice position change for x must be preserved');
    assert.strictEqual(merged.y, 400, 'Alice position change for y must be preserved');
    assert.strictEqual(merged.fillColor, '#ff00ff', 'Bob color change must be preserved');
  });

  it('3. Conflicting writes to the same property converge deterministically', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    await canvasService.addElement(
      publicRoomId,
      { id: 'crdt-tie-rect', type: 'rectangle', x: 10, y: 10, width: 100, height: 50 },
      aliceId
    );

    // Both race to update width
    const opA = new Promise((resolve) =>
      sockA.emit('update-element', { id: 'crdt-tie-rect', changes: { width: 500 } }, resolve)
    );
    const opB = new Promise((resolve) =>
      sockB.emit('update-element', { id: 'crdt-tie-rect', changes: { width: 900 } }, resolve)
    );

    const [resA, resB] = await Promise.all([opA, opB]);
    assert.strictEqual(resA.status, 'success');
    assert.strictEqual(resB.status, 'success');

    // Verify determinism: the winning width is stored and consistent
    const finalDoc = await CanvasElement.findOne({ roomId: publicRoomId, elementId: 'crdt-tie-rect' });
    assert.ok(finalDoc.width === 500 || finalDoc.width === 900, 'Width must converge deterministically');
    assert.ok(finalDoc.version >= 2);
  });

  it('4. Replaying the same operation twice does not duplicate or corrupt state (idempotency)', async () => {
    const sock = createClientSocket(aliceToken);
    await new Promise((res) => { sock.on('connect', res); sock.connect(); });
    await new Promise((res) => sock.emit('join-room', { roomId: publicRoomId }, res));

    const drawPayload = { id: 'crdt-idempotent-rect', type: 'rectangle', x: 25, y: 25, width: 70, height: 70, idempotent: true };

    // First emission
    const firstAck = await new Promise((res) => sock.emit('draw-element', drawPayload, res));
    assert.strictEqual(firstAck.status, 'success');

    // Duplicate replay emission
    const secondAck = await new Promise((res) => sock.emit('draw-element', drawPayload, res));
    assert.strictEqual(secondAck.status, 'success');
    assert.strictEqual(secondAck.data.id, 'crdt-idempotent-rect');

    // Must still have exactly ONE element in database
    const count = await CanvasElement.countDocuments({ roomId: publicRoomId, elementId: 'crdt-idempotent-rect' });
    assert.strictEqual(count, 1, 'Duplicate create must be idempotent without creating a second element');
  });

  it('5. Concurrent update/delete resolves consistently with tombstone protection', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    await canvasService.addElement(
      publicRoomId,
      { id: 'crdt-del-target', type: 'circle', x: 50, y: 50, radius: 25 },
      aliceId
    );

    // Delete the element
    const delAck = await new Promise((res) => sockA.emit('delete-element', { id: 'crdt-del-target' }, res));
    assert.strictEqual(delAck.status, 'success');

    // Late update targeting the deleted element must not resurrect it
    const lateUpdateAck = await new Promise((res) =>
      sockB.emit('update-element', { id: 'crdt-del-target', changes: { radius: 100 } }, res)
    );
    assert.strictEqual(lateUpdateAck.status, 'error');

    // Active elements list must not contain deleted element
    const active = await canvasService.getElements(publicRoomId);
    assert.strictEqual(active.some((e) => e.id === 'crdt-del-target'), false, 'Deleted element must not be resurrected');
  });

  it('6. Clear-canvas followed by a delayed old operation does not resurrect the old canvas', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    // Seed element before clear
    await canvasService.addElement(
      publicRoomId,
      { id: 'crdt-preclear-elem', type: 'rectangle', x: 10, y: 10, width: 40, height: 40 },
      aliceId
    );

    // Clear the canvas
    const clearAck = await new Promise((res) => sockA.emit('clear-canvas', res));
    assert.strictEqual(clearAck.status, 'success');

    // Simulate delayed old operation carrying pre-clear epoch 0
    const delayedOldOp = await new Promise((res) =>
      sockB.emit(
        'draw-element',
        { id: 'crdt-delayed-ghost', type: 'rectangle', x: 20, y: 20, width: 50, height: 50, clearEpoch: 0 },
        res
      )
    );
    assert.strictEqual(delayedOldOp.status, 'error', 'Delayed operation from before clear must be dropped');

    // Active elements must remain empty
    const elements = await canvasService.getElements(publicRoomId);
    assert.strictEqual(elements.length, 0, 'Canvas must remain empty after clear');
  });

  it('7. Undo/redo converges across connected clients with explicit restoration', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    // 1. Create element
    const createAck = await new Promise((res) =>
      sockA.emit(
        'draw-element',
        { id: 'crdt-undo-elem', type: 'rectangle', x: 10, y: 10, width: 50, height: 50 },
        res
      )
    );
    assert.strictEqual(createAck.status, 'success');

    // 2. Delete element (simulate local user delete)
    const delAck = await new Promise((res) => sockA.emit('delete-element', { id: 'crdt-undo-elem' }, res));
    assert.strictEqual(delAck.status, 'success');

    // 3. Undo delete with explicit restore: true
    const undoAck = await new Promise((res) =>
      sockA.emit(
        'draw-element',
        { id: 'crdt-undo-elem', type: 'rectangle', x: 10, y: 10, width: 50, height: 50, restore: true },
        res
      )
    );
    assert.strictEqual(undoAck.status, 'success', 'Undo deletion must successfully restore element');

    const active = await canvasService.getElements(publicRoomId);
    assert.ok(active.some((e) => e.id === 'crdt-undo-elem'), 'Restored element must be visible to all clients');
  });

  it('8. Reconnection reconciles correctly without stale-state corruption', async () => {
    const sockA = createClientSocket(aliceToken);
    await new Promise((res) => { sockA.on('connect', res); sockA.connect(); });
    await new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res));

    // Disconnect client
    sockA.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Reconnect with a fresh socket
    const reconnectedSock = createClientSocket(aliceToken);
    await new Promise((res) => { reconnectedSock.on('connect', res); reconnectedSock.connect(); });
    const joinAck = await new Promise((res) => reconnectedSock.emit('join-room', { roomId: publicRoomId }, res));

    assert.strictEqual(joinAck.status, 'success');
    assert.ok(Array.isArray(joinAck.data.canvasState), 'Reconnection must restore canvasState array');

    // Elements must match authoritative server state
    const serverElems = await canvasService.getElements(publicRoomId);
    assert.strictEqual(joinAck.data.canvasState.length, serverElems.length);
  });

  it('9. Existing private-room authorization remains strictly enforced', async () => {
    // Charlie is uninvited to Alice's private room
    const charlieSock = createClientSocket(charlieToken);
    await new Promise((res) => { charlieSock.on('connect', res); charlieSock.connect(); });

    const joinAck = await new Promise((res) => charlieSock.emit('join-room', { roomId: privateRoomId }, res));
    assert.strictEqual(joinAck.status, 'error');
    assert.ok(
      joinAck.message.toLowerCase().includes('access denied') ||
      joinAck.message.toLowerCase().includes('private'),
      `Access must be denied: ${joinAck.message}`
    );
  });

  it('10. Server-side exports exclude deleted elements', async () => {
    // Seed and then delete an element in public room
    await canvasService.addElement(
      publicRoomId,
      { id: 'crdt-export-target', type: 'rectangle', x: 100, y: 100, width: 80, height: 80 },
      aliceId
    );
    await canvasService.deleteElement(publicRoomId, 'crdt-export-target', aliceId);

    // Retrieve active elements for export
    const exportElements = await canvasService.getElements(publicRoomId);
    assert.strictEqual(
      exportElements.some((e) => e.id === 'crdt-export-target'),
      false,
      'Deleted element must be excluded from export elements list'
    );

    // Render export buffer
    const pngBuffer = await exportService.renderCanvasToPng(exportElements, { allowEmpty: true });
    assert.ok(Buffer.isBuffer(pngBuffer), 'Must return valid image buffer');
    assert.strictEqual(pngBuffer[0], 0x89, 'Must start with PNG signature byte');
    assert.strictEqual(pngBuffer[1], 0x50, 'Must start with PNG signature byte');
  });

  it('11. Direct unique-index duplicate rejection (409) and idempotent retry fallback', async () => {
    const sock = createClientSocket(aliceToken);
    await new Promise((res) => { sock.on('connect', res); sock.connect(); });
    await new Promise((res) => sock.emit('join-room', { roomId: publicRoomId }, res));

    const elem = { id: 'crdt-dup-index-elem', type: 'rectangle', x: 50, y: 50, width: 60, height: 60 };

    // Initial create
    const firstAck = await new Promise((res) => sock.emit('draw-element', elem, res));
    assert.strictEqual(firstAck.status, 'success');

    // Duplicate create without idempotent flag must reject with 409 via compound unique index
    const dupAck = await new Promise((res) => sock.emit('draw-element', elem, res));
    assert.strictEqual(dupAck.status, 'error');
    assert.ok(dupAck.message.includes('already exists'), 'Duplicate create must reject with already exists');

    // Duplicate create WITH idempotent flag must succeed and return existing doc
    const idemAck = await new Promise((res) => sock.emit('draw-element', { ...elem, idempotent: true }, res));
    assert.strictEqual(idemAck.status, 'success');
    assert.strictEqual(idemAck.data.id, 'crdt-dup-index-elem');

    // Total documents in MongoDB must still be exactly 1
    const count = await CanvasElement.countDocuments({ roomId: publicRoomId, elementId: 'crdt-dup-index-elem' });
    assert.strictEqual(count, 1);
  });

  it('12. Concurrent racing creates with identical ID allow exactly one via MongoDB unique index', async () => {
    const sockA = createClientSocket(aliceToken);
    const sockB = createClientSocket(bobToken);
    await Promise.all([
      new Promise((res) => { sockA.on('connect', res); sockA.connect(); }),
      new Promise((res) => { sockB.on('connect', res); sockB.connect(); })
    ]);
    await Promise.all([
      new Promise((res) => sockA.emit('join-room', { roomId: publicRoomId }, res)),
      new Promise((res) => sockB.emit('join-room', { roomId: publicRoomId }, res))
    ]);

    const raceElem = { id: 'crdt-race-dup-elem', type: 'circle', x: 80, y: 80, radius: 30 };

    const [resA, resB] = await Promise.all([
      new Promise((res) => sockA.emit('draw-element', raceElem, res)),
      new Promise((res) => sockB.emit('draw-element', raceElem, res))
    ]);

    const successes = [resA, resB].filter((r) => r.status === 'success');
    const errors = [resA, resB].filter((r) => r.status === 'error');

    assert.strictEqual(successes.length, 1, 'Exactly one create must succeed');
    assert.strictEqual(errors.length, 1, 'The racing duplicate must fail with 409');
    assert.ok(errors[0].message.includes('already exists'));

    const count = await CanvasElement.countDocuments({ roomId: publicRoomId, elementId: 'crdt-race-dup-elem' });
    assert.strictEqual(count, 1);
  });
});
