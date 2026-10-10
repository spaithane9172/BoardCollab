const http = require('http');
const mongoose = require('mongoose');
const { performance } = require('perf_hooks');
const os = require('os');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_phase51_scale';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_p51_scale';

const app = require('../src/app');
const { initSocketIO, presenceManager, canvasService } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');

// Configuration
const TOTAL_ELEMENTS = parseInt(process.env.ELEMENT_COUNT, 10) || 10000;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 1000;

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemorySnapshot() {
  const mem = process.memoryUsage();
  return {
    rss: formatMB(mem.rss),
    heapUsed: formatMB(mem.heapUsed),
    heapTotal: formatMB(mem.heapTotal),
    rawHeapUsed: mem.heapUsed
  };
}

async function runScaleBenchmark() {
  console.log('='.repeat(70));
  console.log('  BOARDCOLLAB — 10,000 CANVAS ELEMENTS SCALE BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Node Runtime     : ${process.version} (${process.platform} ${process.arch})`);
  console.log(`CPU Architecture : ${os.cpus()[0]?.model} (${os.cpus().length} vCPUs)`);
  console.log(`Total System RAM : ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`Target Scale     : ${TOTAL_ELEMENTS.toLocaleString()} canvas elements`);
  console.log(`Batch Size       : ${BATCH_SIZE.toLocaleString()} elements per batch`);
  console.log('-'.repeat(70));

  await mongoose.connect(TEST_DB_URI);
  await User.deleteMany({});
  await Room.deleteMany({});
  await CanvasElement.deleteMany({});
  presenceManager.clear();

  const server = http.createServer(app);
  const ioServer = initSocketIO(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  const socketUrl = `http://localhost:${port}`;

  try {
    // 1. Setup Test User and Room
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Scale Benchmark User',
        email: 'scale_user@example.com',
        password: 'Password123!'
      })
    });
    const regData = await regRes.json();
    const token = regData.data.token;
    const userId = regData.data.user._id || regData.data.user.id;

    const roomRes = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Scale Test Canvas Room',
        access: 'public'
      })
    });
    const roomData = await roomRes.json();
    const roomId = roomData.data.roomId;

    const memInitial = getMemorySnapshot();
    console.log(`Initial Memory Usage: RSS ${memInitial.rss} | Heap Used ${memInitial.heapUsed}`);

    // 2. Batch Seeding of 10,000 elements
    console.log(`\n[Step 1] Seeding ${TOTAL_ELEMENTS.toLocaleString()} elements in batches of ${BATCH_SIZE}...`);
    const seedStart = performance.now();

    const elementTypes = ['rectangle', 'circle', 'text', 'stroke'];
    let seededCount = 0;

    for (let i = 0; i < TOTAL_ELEMENTS; i += BATCH_SIZE) {
      const currentBatchCount = Math.min(BATCH_SIZE, TOTAL_ELEMENTS - i);
      const batchDocs = [];

      for (let j = 0; j < currentBatchCount; j++) {
        const idx = i + j + 1;
        const type = elementTypes[idx % elementTypes.length];
        const doc = {
          roomId,
          elementId: `scale-elem-${idx}`,
          type,
          createdBy: userId.toString(),
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          strokeColor: '#2563eb',
          strokeWidth: 2
        };

        if (type === 'rectangle') {
          doc.x = (idx * 50) % 5000;
          doc.y = (idx * 30) % 5000;
          doc.width = 100;
          doc.height = 60;
          doc.fillColor = '#93c5fd';
        } else if (type === 'circle') {
          doc.x = (idx * 40) % 5000;
          doc.y = (idx * 40) % 5000;
          doc.radius = 35;
          doc.fillColor = '#fca5a5';
        } else if (type === 'text') {
          doc.x = (idx * 25) % 5000;
          doc.y = (idx * 45) % 5000;
          doc.text = `Element #${idx}`;
          doc.fontSize = 16;
        } else if (type === 'stroke') {
          doc.points = [10, 10, 20, 20, 30, 25, 40, 30];
        }

        batchDocs.push(doc);
      }

      await CanvasElement.insertMany(batchDocs, { ordered: false });
      seededCount += currentBatchCount;
      process.stdout.write(`  -> Seeded ${seededCount.toLocaleString()} / ${TOTAL_ELEMENTS.toLocaleString()} elements...\r`);
    }

    const seedEnd = performance.now();
    const seedDurationMs = seedEnd - seedStart;
    const seedThroughput = ((TOTAL_ELEMENTS / seedDurationMs) * 1000).toFixed(1);

    console.log(`\n  Seeding Complete: ${TOTAL_ELEMENTS.toLocaleString()} elements in ${(seedDurationMs / 1000).toFixed(2)}s (${seedThroughput} elements/sec)`);

    const memAfterSeed = getMemorySnapshot();
    console.log(`  Memory After Seeding: RSS ${memAfterSeed.rss} | Heap Used ${memAfterSeed.heapUsed}`);

    // 3. Database Retrieval Benchmark
    console.log(`\n[Step 2] Retrieving full room canvas from MongoDB (CanvasService.getElements)...`);
    const fetchStart = performance.now();
    const retrievedElements = await canvasService.getElements(roomId);
    const fetchEnd = performance.now();
    const fetchDurationMs = fetchEnd - fetchStart;

    const payloadJson = JSON.stringify(retrievedElements);
    const payloadSizeBytes = Buffer.byteLength(payloadJson, 'utf8');
    const payloadSizeMB = (payloadSizeBytes / 1024 / 1024).toFixed(2);

    console.log(`  Retrieval Complete:`);
    console.log(`  - Count Retrieved : ${retrievedElements.length.toLocaleString()} elements`);
    console.log(`  - DB Query Time   : ${fetchDurationMs.toFixed(2)} ms (${(fetchDurationMs / 1000).toFixed(3)}s)`);
    console.log(`  - Payload Size    : ${payloadSizeMB} MB (${payloadSizeBytes.toLocaleString()} bytes)`);

    const memAfterFetch = getMemorySnapshot();
    console.log(`  Memory After Fetch: RSS ${memAfterFetch.rss} | Heap Used ${memAfterFetch.heapUsed}`);

    // 4. Socket.IO Room-Join & State Delivery
    console.log(`\n[Step 3] Socket.IO Client Room-Join & Canvas-State Delivery...`);
    const client = Client(socketUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise((resolve, reject) => {
      client.on('connect', resolve);
      client.on('connect_error', reject);
    });

    const socketDeliveryStart = performance.now();
    const joinResponse = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket join-room timed out')), 15000);
      client.emit('join-room', { roomId }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });
    const socketDeliveryEnd = performance.now();
    const socketDeliveryMs = socketDeliveryEnd - socketDeliveryStart;

    if (joinResponse.status !== 'success') {
      throw new Error(`Socket join-room failed: ${joinResponse.message}`);
    }

    const deliveredCount = joinResponse.data?.canvasState?.length || 0;
    console.log(`  Socket Delivery Complete:`);
    console.log(`  - Elements Delivered : ${deliveredCount.toLocaleString()} elements`);
    console.log(`  - Socket Delivery Time: ${socketDeliveryMs.toFixed(2)} ms (${(socketDeliveryMs / 1000).toFixed(3)}s)`);

    const memFinal = getMemorySnapshot();
    console.log(`  Memory After Delivery: RSS ${memFinal.rss} | Heap Used ${memFinal.heapUsed}`);

    client.disconnect();

    // 5. Benchmark Summary Table
    console.log('\n' + '='.repeat(70));
    console.log('  SCALE BENCHMARK RESULTS SUMMARY');
    console.log('='.repeat(70));
    console.log(`  Status                        : SUCCESS (0 errors, 0 timeouts)`);
    console.log(`  Total Canvas Elements         : ${TOTAL_ELEMENTS.toLocaleString()}`);
    console.log(`  Batch Ingestion Time (DB seed): ${seedDurationMs.toFixed(1)} ms (${(seedDurationMs / 1000).toFixed(2)}s)`);
    console.log(`  Batch Ingestion Throughput    : ${seedThroughput} ops/sec`);
    console.log(`  Full Canvas Retrieval (DB)    : ${fetchDurationMs.toFixed(1)} ms`);
    console.log(`  Socket Delivery Time (Wire)   : ${socketDeliveryMs.toFixed(1)} ms`);
    console.log(`  Full Canvas Payload Size      : ${payloadSizeMB} MB`);
    console.log(`  Peak Heap Used                : ${memFinal.heapUsed} (initial: ${memInitial.heapUsed})`);
    console.log('='.repeat(70));

    // Cleanup
    await CanvasElement.deleteMany({ roomId });
    await Room.deleteMany({ roomId });
    await User.deleteMany({ _id: userId });
  } finally {
    if (ioServer) {
      await new Promise((resolve) => ioServer.close(resolve));
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  runScaleBenchmark().catch((err) => {
    console.error('Scale benchmark failed:', err);
    process.exit(1);
  });
}

module.exports = runScaleBenchmark;
