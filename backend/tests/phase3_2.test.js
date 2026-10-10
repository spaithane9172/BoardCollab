const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { io: Client } = require('socket.io-client');

// Test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_canvas_32';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p32';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');

describe('Phase 3.2: Real-Time Drawing and Canvas Synchronization Tests', () => {
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

  let room1Id;
  let room2Id;

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
    presenceManager.clear();
    await canvasService.clear();

    server = http.createServer(app);
    ioServer = initSocketIO(server);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    socketUrl = `http://localhost:${port}`;

    // Register users
    const resAlice = await request('POST', '/api/auth/register', {
      body: { name: 'Alice Painter', email: 'alice_canvas@example.com', password: 'Password123!' }
    });
    aliceToken = resAlice.data.data.token;
    aliceId = resAlice.data.data.user._id;

    const resBob = await request('POST', '/api/auth/register', {
      body: { name: 'Bob Sketcher', email: 'bob_canvas@example.com', password: 'Password123!' }
    });
    bobToken = resBob.data.data.token;
    bobId = resBob.data.data.user._id;

    const resCharlie = await request('POST', '/api/auth/register', {
      body: { name: 'Charlie Viewer', email: 'charlie_canvas@example.com', password: 'Password123!' }
    });
    charlieToken = resCharlie.data.data.token;
    charlieId = resCharlie.data.data.user._id;

    // Create 2 separate public rooms
    const r1 = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Room Alpha', access: 'public', roomId: 'canvas-room-alpha' }
    });
    room1Id = r1.data.data.roomId;

    const r2 = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: { name: 'Room Beta', access: 'public', roomId: 'canvas-room-beta' }
    });
    room2Id = r2.data.data.roomId;
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

  describe('1. Element Creation & Types', () => {
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

      // Both join room1
      await new Promise((res) => aliceSocket.emit('join-room', { roomId: room1Id }, res));
      await new Promise((res) => bobSocket.emit('join-room', { roomId: room1Id }, res));
    });

    it('should draw a stroke element and assign authoritative server fields', async () => {
      const strokePayload = {
        id: 'stroke-1',
        type: 'stroke',
        points: [
          { x: 10, y: 20 },
          { x: 15, y: 25 },
          { x: 20, y: 30 }
        ],
        strokeColor: '#ff0000',
        strokeWidth: 4,
        opacity: 0.9,
        // Client attempt to spoof identity
        createdBy: 'fake-user-id',
        version: 99
      };

      const ack = await new Promise((res) => aliceSocket.emit('draw-element', strokePayload, res));

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'stroke-1');
      assert.strictEqual(ack.data.type, 'stroke');
      assert.strictEqual(ack.data.createdBy, aliceId);
      assert.strictEqual(ack.data.version, 1);
      assert.ok(ack.data.createdAt);
      assert.ok(ack.data.updatedAt);
      assert.strictEqual(ack.data.strokeColor, '#ff0000');
      assert.strictEqual(ack.data.strokeWidth, 4);
      assert.strictEqual(ack.data.opacity, 0.9);
      assert.strictEqual(ack.data.points.length, 3);
    });

    it('should draw a rectangle element with valid coordinates', async () => {
      const rectPayload = {
        id: 'rect-1',
        type: 'rectangle',
        x: 50,
        y: 60,
        width: 200,
        height: 100,
        fillColor: '#00ff00',
        strokeColor: '#000000',
        strokeWidth: 2
      };

      const ack = await new Promise((res) => aliceSocket.emit('draw-element', rectPayload, res));

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'rect-1');
      assert.strictEqual(ack.data.type, 'rectangle');
      assert.strictEqual(ack.data.width, 200);
      assert.strictEqual(ack.data.height, 100);
      assert.strictEqual(ack.data.fillColor, '#00ff00');
    });

    it('should draw a circle element with valid center and radius', async () => {
      const circlePayload = {
        id: 'circle-1',
        type: 'circle',
        x: 150,
        y: 150,
        radius: 45,
        fillColor: '#0000ff',
        opacity: 0.8
      };

      const ack = await new Promise((res) => aliceSocket.emit('draw-element', circlePayload, res));

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'circle-1');
      assert.strictEqual(ack.data.type, 'circle');
      assert.strictEqual(ack.data.radius, 45);
    });

    it('should draw a text element with valid content and font size', async () => {
      const textPayload = {
        id: 'text-1',
        type: 'text',
        x: 300,
        y: 100,
        text: 'Hello BoardCollab!',
        fontSize: 24,
        fontFamily: 'Inter',
        fillColor: '#333333'
      };

      const ack = await new Promise((res) => aliceSocket.emit('draw-element', textPayload, res));

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'text-1');
      assert.strictEqual(ack.data.type, 'text');
      assert.strictEqual(ack.data.text, 'Hello BoardCollab!');
      assert.strictEqual(ack.data.fontSize, 24);
      assert.strictEqual(ack.data.fontFamily, 'Inter');
    });

    it('should reject drawing with duplicate element ID', async () => {
      const duplicatePayload = {
        id: 'rect-1', // already drawn above
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 50,
        height: 50
      };

      const ack = await new Promise((res) => aliceSocket.emit('draw-element', duplicatePayload, res));

      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /already exists/i);
    });
  });

  describe('2. Broadcasting & Echo Avoidance', () => {
    it('should broadcast canvas-operation to other room sockets and NOT back to sender', async () => {
      const aliceSocket = createClientSocket(aliceToken);
      const bobSocket = createClientSocket(bobToken);

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

      await new Promise((res) => aliceSocket.emit('join-room', { roomId: room1Id }, res));
      await new Promise((res) => bobSocket.emit('join-room', { roomId: room1Id }, res));

      let aliceReceivedEcho = false;
      aliceSocket.on('canvas-operation', () => {
        aliceReceivedEcho = true;
      });

      const bobOperationPromise = new Promise((resolve) => {
        bobSocket.on('canvas-operation', resolve);
      });

      // Alice draws element
      const ack = await new Promise((res) =>
        aliceSocket.emit(
          'draw-element',
          {
            id: 'broadcast-test-rect',
            type: 'rectangle',
            x: 20,
            y: 30,
            width: 80,
            height: 40
          },
          res
        )
      );

      assert.strictEqual(ack.status, 'success');

      // Bob should receive operation
      const receivedOp = await bobOperationPromise;
      assert.strictEqual(receivedOp.action, 'create');
      assert.strictEqual(receivedOp.element.id, 'broadcast-test-rect');
      assert.strictEqual(receivedOp.element.createdBy, aliceId);

      // Give event loop time to verify Alice didn't receive echo
      await new Promise((res) => setTimeout(res, 50));
      assert.strictEqual(aliceReceivedEcho, false, 'Sender must not receive echo of own operation');
    });
  });

  describe('3. Late Joiner Canvas State Synchronization', () => {
    it('should return all current canvas elements when a new participant joins', async () => {
      // Charlie connects and joins room1 for the first time
      const charlieSocket = createClientSocket(charlieToken);
      await new Promise((res) => {
        charlieSocket.on('connect', res);
        charlieSocket.connect();
      });

      const joinAck = await new Promise((res) =>
        charlieSocket.emit('join-room', { roomId: room1Id }, res)
      );

      assert.strictEqual(joinAck.status, 'success');
      assert.ok(Array.isArray(joinAck.data.canvasState));
      // Elements drawn in previous tests: stroke-1, rect-1, circle-1, text-1, broadcast-test-rect
      assert.ok(joinAck.data.canvasState.length >= 5);

      const elementIds = joinAck.data.canvasState.map((el) => el.id);
      assert.ok(elementIds.includes('stroke-1'));
      assert.ok(elementIds.includes('rect-1'));
      assert.ok(elementIds.includes('circle-1'));
      assert.ok(elementIds.includes('text-1'));
      assert.ok(elementIds.includes('broadcast-test-rect'));
    });
  });

  describe('4. Payload Validation and Error Guardrails', () => {
    let testSocket;

    before(async () => {
      testSocket = createClientSocket(aliceToken);
      await new Promise((res) => {
        testSocket.on('connect', res);
        testSocket.connect();
      });
      await new Promise((res) => testSocket.emit('join-room', { roomId: room1Id }, res));
    });

    it('should reject element with unsupported type', async () => {
      const ack = await new Promise((res) =>
        testSocket.emit('draw-element', { id: 'invalid-type-1', type: 'triangle', x: 0, y: 0 }, res)
      );
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /type must be one of/i);
    });

    it('should reject malformed or non-object payload', async () => {
      const ack = await new Promise((res) => testSocket.emit('draw-element', 'just-a-string', res));
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /must be an object/i);
    });

    it('should reject non-finite numbers (NaN, Infinity)', async () => {
      const ackNaN = await new Promise((res) =>
        testSocket.emit(
          'draw-element',
          { id: 'nan-rect', type: 'rectangle', x: NaN, y: 10, width: 50, height: 50 },
          res
        )
      );
      assert.strictEqual(ackNaN.status, 'error');
      assert.match(ackNaN.message, /finite/i);

      const ackInf = await new Promise((res) =>
        testSocket.emit(
          'draw-element',
          { id: 'inf-rect', type: 'rectangle', x: 10, y: 10, width: Infinity, height: 50 },
          res
        )
      );
      assert.strictEqual(ackInf.status, 'error');
      assert.match(ackInf.message, /between 0 and 50000/i);
    });

    it('should reject oversized stroke points array', async () => {
      // 2500 points exceeds limit of 2000
      const largePoints = Array.from({ length: 2500 }, (_, i) => ({ x: i, y: i }));
      const ack = await new Promise((res) =>
        testSocket.emit('draw-element', { id: 'big-stroke', type: 'stroke', points: largePoints }, res)
      );
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /exceeds maximum length/i);
    });

    it('should reject oversized text content', async () => {
      const bigText = 'A'.repeat(1500); // Exceeds limit of 1000
      const ack = await new Promise((res) =>
        testSocket.emit('draw-element', { id: 'big-text', type: 'text', x: 10, y: 10, text: bigText }, res)
      );
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /between 1 and 1000 characters/i);
    });

    it('should reject invalid styling values', async () => {
      const ack = await new Promise((res) =>
        testSocket.emit(
          'draw-element',
          { id: 'bad-style', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, opacity: 2.5 },
          res
        )
      );
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /opacity must be a number between 0 and 1/i);
    });
  });

  describe('5. Element Updates and Immutability', () => {
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

      await new Promise((res) => aliceSocket.emit('join-room', { roomId: room1Id }, res));
      await new Promise((res) => bobSocket.emit('join-room', { roomId: room1Id }, res));
    });

    it('should successfully update an existing element and broadcast update', async () => {
      const bobUpdatePromise = new Promise((resolve) => {
        bobSocket.on('canvas-operation', (op) => {
          if (op.action === 'update' && op.element.id === 'rect-1') resolve(op);
        });
      });

      const ack = await new Promise((res) =>
        aliceSocket.emit(
          'update-element',
          {
            id: 'rect-1',
            width: 350,
            fillColor: '#ffff00'
          },
          res
        )
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'rect-1');
      assert.strictEqual(ack.data.width, 350);
      assert.strictEqual(ack.data.fillColor, '#ffff00');
      assert.strictEqual(ack.data.version, 2, 'Version should increment to 2');

      const broadcastOp = await bobUpdatePromise;
      assert.strictEqual(broadcastOp.action, 'update');
      assert.strictEqual(broadcastOp.element.width, 350);
      assert.strictEqual(broadcastOp.element.fillColor, '#ffff00');
    });

    it('should fail when updating a nonexistent element', async () => {
      const ack = await new Promise((res) =>
        aliceSocket.emit('update-element', { id: 'ghost-element', width: 100 }, res)
      );
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /not found in room/i);
    });

    it('should reject attempts to modify immutable fields (createdBy, createdAt, type)', async () => {
      const ack = await new Promise((res) =>
        aliceSocket.emit(
          'update-element',
          {
            id: 'rect-1',
            createdBy: bobId // Attempt to steal credit
          },
          res
        )
      );

      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /immutable and cannot be modified/i);
    });
  });

  describe('6. Element Deletion', () => {
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

      await new Promise((res) => aliceSocket.emit('join-room', { roomId: room1Id }, res));
      await new Promise((res) => bobSocket.emit('join-room', { roomId: room1Id }, res));
    });

    it('should delete an existing element and broadcast deletion to peers', async () => {
      const bobDeletePromise = new Promise((resolve) => {
        bobSocket.on('canvas-operation', (op) => {
          if (op.action === 'delete') resolve(op);
        });
      });

      const ack = await new Promise((res) =>
        aliceSocket.emit('delete-element', { id: 'circle-1' }, res)
      );

      assert.strictEqual(ack.status, 'success');
      assert.strictEqual(ack.data.id, 'circle-1');

      const broadcastOp = await bobDeletePromise;
      assert.strictEqual(broadcastOp.action, 'delete');
      assert.strictEqual(broadcastOp.elementId, 'circle-1');

      // Verify element is no longer in canvasState
      const charlieSocket = createClientSocket(charlieToken);
      await new Promise((res) => {
        charlieSocket.on('connect', res);
        charlieSocket.connect();
      });
      const joinAck = await new Promise((res) =>
        charlieSocket.emit('join-room', { roomId: room1Id }, res)
      );
      const remainingIds = joinAck.data.canvasState.map((el) => el.id);
      assert.strictEqual(remainingIds.includes('circle-1'), false, 'Deleted element must not be in canvasState');
    });

    it('should fail when deleting a nonexistent element', async () => {
      const ack = await new Promise((res) =>
        aliceSocket.emit('delete-element', { id: 'circle-1' }, res)
      ); // already deleted
      assert.strictEqual(ack.status, 'error');
      assert.match(ack.message, /not found in room/i);
    });
  });

  describe('7. Room Boundary & Unjoined Socket Isolation', () => {
    it('should reject canvas operations from a socket that has not joined a room', async () => {
      const unjoinedSocket = createClientSocket(aliceToken);
      await new Promise((res) => {
        unjoinedSocket.on('connect', res);
        unjoinedSocket.connect();
      });

      const drawAck = await new Promise((res) =>
        unjoinedSocket.emit(
          'draw-element',
          { id: 'unjoined-el', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
          res
        )
      );
      assert.strictEqual(drawAck.status, 'error');
      assert.match(drawAck.message, /must join a room before modifying the canvas/i);

      const updateAck = await new Promise((res) =>
        unjoinedSocket.emit('update-element', { id: 'rect-1', width: 20 }, res)
      );
      assert.strictEqual(updateAck.status, 'error');
      assert.match(updateAck.message, /must join a room before modifying the canvas/i);

      const deleteAck = await new Promise((res) =>
        unjoinedSocket.emit('delete-element', { id: 'rect-1' }, res)
      );
      assert.strictEqual(deleteAck.status, 'error');
      assert.match(deleteAck.message, /must join a room before modifying the canvas/i);
    });

    it('should prevent operations in one room from affecting elements in another room', async () => {
      const socketInRoom2 = createClientSocket(aliceToken);
      await new Promise((res) => {
        socketInRoom2.on('connect', res);
        socketInRoom2.connect();
      });
      // Joins Room Beta (room2Id)
      await new Promise((res) => socketInRoom2.emit('join-room', { roomId: room2Id }, res));

      // Attempt to update 'rect-1' (which exists only in Room Alpha / room1Id)
      const ackUpdate = await new Promise((res) =>
        socketInRoom2.emit('update-element', { id: 'rect-1', width: 999 }, res)
      );
      assert.strictEqual(ackUpdate.status, 'error');
      assert.match(ackUpdate.message, /not found in room/i);

      // Attempt to delete 'rect-1' from Room Beta
      const ackDelete = await new Promise((res) =>
        socketInRoom2.emit('delete-element', { id: 'rect-1' }, res)
      );
      assert.strictEqual(ackDelete.status, 'error');
      assert.match(ackDelete.message, /not found in room/i);
    });
  });

  describe('8. Regression: Health and REST APIs', () => {
    it('should preserve GET /api/health', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
    });

    it('should preserve REST room retrieval', async () => {
      const res = await request('GET', `/api/rooms/${room1Id}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.roomId, room1Id);
    });
  });
});
