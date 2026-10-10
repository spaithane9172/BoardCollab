const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_export_canvas';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_export';

const app = require('../src/app');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');
const canvasService = require('../src/services/canvas.service');
const { calculateElementsBounds, renderCanvasToPng } = require('../src/services/export.service');

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

describe('POST /api/rooms/:id/export — Server-Side Room Export', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userAId;
  let userBToken;
  let userBId;
  let userAPublicRoom;
  let userAPrivateRoom;

  const request = async (method, path, options = {}) => {
    const url = `${baseUrl}${path}`;
    const headers = {
      ...(options.headers || {})
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({}));
      return { status: res.status, headers: res.headers, data };
    }

    const arrayBuffer = await res.arrayBuffer();
    return { status: res.status, headers: res.headers, buffer: Buffer.from(arrayBuffer) };
  };

  before(async () => {
    await mongoose.connect(TEST_DB_URI);
    await User.deleteMany({});
    await Room.deleteMany({});
    await CanvasElement.deleteMany({});

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // Register User A
    const resA = await request('POST', '/api/auth/register', {
      body: { name: 'User A', email: 'userA_export@example.com', password: 'password123' }
    });
    assert.strictEqual(resA.status, 201);
    userAToken = resA.data.data.token;
    userAId = resA.data.data.user._id;

    // Register User B
    const resB = await request('POST', '/api/auth/register', {
      body: { name: 'User B', email: 'userB_export@example.com', password: 'password123' }
    });
    assert.strictEqual(resB.status, 201);
    userBToken = resB.data.data.token;
    userBId = resB.data.data.user._id;

    // User A creates Public Room
    const pubRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` },
      body: { name: 'Public Art Room', access: 'public', roomId: 'pub-export-1' }
    });
    assert.strictEqual(pubRes.status, 201);
    userAPublicRoom = pubRes.data.data;

    // User A creates Private Room
    const privRes = await request('POST', '/api/rooms', {
      headers: { Authorization: `Bearer ${userAToken}` },
      body: { name: 'Secret Blueprint', access: 'private', roomId: 'priv-export-1' }
    });
    assert.strictEqual(privRes.status, 201);
    userAPrivateRoom = privRes.data.data;
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

  describe('1. Endpoint Authentication & Room Access Control', () => {
    it('rejects unauthenticated requests to POST /api/rooms/:id/export with 401', async () => {
      const res = await request('POST', `/api/rooms/${userAPublicRoom.roomId}/export`);
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.status, 'error');
    });

    it('returns 404 when exporting a non-existent room', async () => {
      const res = await request('POST', '/api/rooms/room-does-not-exist-999/export', {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.status, 'error');
      assert.strictEqual(res.data.message, 'Room not found');
    });

    it('denies export of private room to unauthorized non-member with 403', async () => {
      // User B tries to export User A's private room
      const res = await request('POST', `/api/rooms/${userAPrivateRoom.roomId}/export`, {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.status, 'error');
      assert.ok(res.data.message.includes('not a member'));
    });

    it('permits authorized member to export private room', async () => {
      // User A (owner and member) exports private room
      const res = await request('POST', `/api/rooms/${userAPrivateRoom.roomId}/export`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      assert.ok(res.buffer);
      assert.strictEqual(res.buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES), true);
    });
  });

  describe('2. Canvas Elements Rendering & Supported Types', () => {
    before(async () => {
      // Seed persisted elements into Public Room covering all 4 supported types
      await canvasService.addElement(
        userAPublicRoom.roomId,
        {
          id: 'stroke-1',
          type: 'stroke',
          points: [10, 10, 50, 60, 100, 80],
          strokeColor: '#f59e0b',
          strokeWidth: 4
        },
        userAId
      );

      await canvasService.addElement(
        userAPublicRoom.roomId,
        {
          id: 'rect-1',
          type: 'rectangle',
          x: 120,
          y: 40,
          width: 150,
          height: 100,
          strokeColor: '#6366f1',
          fillColor: '#818cf8',
          strokeWidth: 2
        },
        userAId
      );

      await canvasService.addElement(
        userAPublicRoom.roomId,
        {
          id: 'circle-1',
          type: 'circle',
          x: 350,
          y: 120,
          radius: 50,
          strokeColor: '#10b981',
          fillColor: '#34d399',
          strokeWidth: 3
        },
        userAId
      );

      await canvasService.addElement(
        userAPublicRoom.roomId,
        {
          id: 'text-1',
          type: 'text',
          x: 50,
          y: 220,
          text: 'BoardCollab Architecture',
          fontSize: 22,
          strokeColor: '#f9fafb'
        },
        userAId
      );
    });

    it('generates a valid PNG containing strokes, rectangles, circles, and text', async () => {
      const res = await request('POST', `/api/rooms/${userAPublicRoom.roomId}/export`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      assert.ok(res.headers.get('content-disposition').includes(`${userAPublicRoom.roomId}.png`));

      const buf = res.buffer;
      assert.ok(Buffer.isBuffer(buf), 'Server response must be a raw binary Buffer, not text or JSON');
      assert.ok(buf.length > 500, `Buffer should contain valid PNG bytes, got length ${buf.length}`);
      assert.strictEqual(buf.subarray(0, 8).equals(PNG_MAGIC_BYTES), true, 'Must have valid 8-byte PNG header');
      assert.strictEqual(
        buf.subarray(buf.length - 12).equals(PNG_IEND_BYTES),
        true,
        'Must end with valid 12-byte PNG IEND chunk'
      );
    });

    it('supports custom background color and padding options', async () => {
      const res = await request('POST', `/api/rooms/${userAPublicRoom.roomId}/export`, {
        headers: { Authorization: `Bearer ${userBToken}` }, // User B can view public room
        body: {
          backgroundColor: '#ffffff',
          padding: 60
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      assert.ok(res.buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES), true);
      assert.ok(res.buffer.subarray(res.buffer.length - 12).equals(PNG_IEND_BYTES), true);
    });
  });

  describe('3. Empty Canvas Validation & Error Handling', () => {
    let emptyRoomId;

    before(async () => {
      const emptyRes = await request('POST', '/api/rooms', {
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { name: 'Completely Empty Room', access: 'public', roomId: 'empty-export-room' }
      });
      assert.strictEqual(emptyRes.status, 201);
      emptyRoomId = emptyRes.data.data.roomId;
    });

    it('exports an empty room with placeholder when allowEmpty is true or omitted', async () => {
      const res = await request('POST', `/api/rooms/${emptyRoomId}/export`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      assert.ok(Buffer.isBuffer(res.buffer), 'Empty canvas export must be binary Buffer');
      assert.strictEqual(res.buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES), true, 'Must have valid 8-byte PNG header');
      assert.strictEqual(
        res.buffer.subarray(res.buffer.length - 12).equals(PNG_IEND_BYTES),
        true,
        'Must end with valid 12-byte PNG IEND chunk'
      );
    });

    it('returns 400 Bad Request when allowEmpty is set to false for empty room', async () => {
      const res = await request('POST', `/api/rooms/${emptyRoomId}/export`, {
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { allowEmpty: false }
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.status, 'error');
      assert.strictEqual(res.data.message, 'Canvas is empty, nothing to export');
    });
  });

  describe('4. Export Service Unit Validation', () => {
    it('calculates bounding box accurately for various shapes', () => {
      const elements = [
        { type: 'rectangle', x: 100, y: 100, width: 200, height: 100 },
        { type: 'circle', x: 400, y: 200, radius: 50 },
        { type: 'stroke', points: [{ x: 50, y: 50 }, { x: 80, y: 80 }] }
      ];

      const bounds = calculateElementsBounds(elements, 20);
      assert.strictEqual(bounds.minX, 30); // min x is 50 - 20
      assert.strictEqual(bounds.minY, 30); // min y is 50 - 20
      assert.ok(bounds.maxX >= 450 + 20); // circle max is 400 + 50 + 20
      assert.ok(bounds.width > 0);
      assert.ok(bounds.height > 0);
    });

    it('renders stroke with object points array [{x, y}] to valid PNG', () => {
      const elements = [
        {
          type: 'stroke',
          points: [{ x: 10, y: 10 }, { x: 30, y: 50 }, { x: 70, y: 20 }],
          strokeColor: '#3b82f6',
          strokeWidth: 3
        }
      ];

      const buf = renderCanvasToPng(elements);
      assert.ok(Buffer.isBuffer(buf));
      assert.strictEqual(buf.subarray(0, 8).equals(PNG_MAGIC_BYTES), true);
    });

    it('throws error when elements argument is not an array', () => {
      assert.throws(() => {
        renderCanvasToPng('not-array');
      }, /must be an array/);
    });
  });
});
