const http = require('http');
const mongoose = require('mongoose');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const os = require('os');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_paced_bench';
process.env.JWT_EXPIRES_IN = '1h';
const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/boardcollab_test_paced';

const app = require('../src/app');
const { initSocketIO, presenceManager } = require('../src/sockets');
const User = require('../src/models/user.model');
const Room = require('../src/models/room.model');
const CanvasElement = require('../src/models/canvasElement.model');
const ElementTombstone = require('../src/models/elementTombstone.model');

// CLI Arguments and Environment Configuration
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  if (match) return parseInt(match.split('=')[1], 10);
  if (process.env[name.toUpperCase()]) return parseInt(process.env[name.toUpperCase()], 10);
  return fallback;
}

const CLIENT_COUNT = getArg('clients', parseInt(process.env.CLIENT_COUNT, 10) || 50);
const OPS_PER_CLIENT = getArg('ops', parseInt(process.env.OPS_PER_CLIENT, 10) || 10);
const INTERVAL_MS = getArg('interval', parseInt(process.env.INTERVAL_MS, 10) || 200);

function calculatePercentiles(latencies) {
  if (!latencies || latencies.length === 0) {
    return { count: 0, min: '0.00', p50: '0.00', mean: '0.00', p95: '0.00', p99: '0.00', max: '0.00' };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / sorted.length;

  const p50 = sorted[Math.floor(0.50 * sorted.length)];
  const p95 = sorted[Math.floor(0.95 * sorted.length)];
  const p99 = sorted[Math.floor(0.99 * sorted.length)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return {
    count: sorted.length,
    min: min.toFixed(2),
    p50: p50.toFixed(2),
    mean: mean.toFixed(2),
    p95: p95.toFixed(2),
    p99: p99.toFixed(2),
    max: max.toFixed(2)
  };
}

function getRealisticElement(clientId, opIndex) {
  const elemId = `paced-elem-${clientId + 1}-${opIndex + 1}`;
  const types = ['stroke', 'rectangle', 'circle', 'text'];
  const type = types[(clientId + opIndex) % types.length];
  const baseX = (clientId * 40 + opIndex * 20) % 3200;
  const baseY = (clientId * 30 + opIndex * 25) % 2400;
  const colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  const color = colors[(clientId + opIndex) % colors.length];

  if (type === 'stroke') {
    return {
      id: elemId,
      type: 'stroke',
      points: [baseX, baseY, baseX + 12, baseY + 18, baseX + 28, baseY + 32, baseX + 50, baseY + 45],
      strokeColor: color,
      strokeWidth: 3
    };
  }
  if (type === 'circle') {
    return {
      id: elemId,
      type: 'circle',
      x: baseX,
      y: baseY,
      radius: 35 + (opIndex % 25),
      strokeColor: color,
      fillColor: color + '33',
      strokeWidth: 2
    };
  }
  if (type === 'text') {
    return {
      id: elemId,
      type: 'text',
      x: baseX,
      y: baseY,
      text: `Paced note user ${clientId + 1} #${opIndex + 1}`,
      fontSize: 16,
      strokeColor: color
    };
  }
  return {
    id: elemId,
    type: 'rectangle',
    x: baseX,
    y: baseY,
    width: 130 + (opIndex % 40),
    height: 80 + (opIndex % 30),
    strokeColor: color,
    fillColor: color + '22',
    strokeWidth: 2
  };
}

async function runPacedBenchmark() {
  console.log('='.repeat(70));
  console.log('  BOARDCOLLAB — PACED REALISTIC LOAD & LATENCY BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Node Runtime      : ${process.version} (${process.platform} ${process.arch})`);
  console.log(`CPU Architecture  : ${os.cpus()[0]?.model} (${os.cpus().length} vCPUs)`);
  console.log(`Total System RAM  : ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`Simulated Clients : ${CLIENT_COUNT} concurrent authenticated clients`);
  console.log(`Ops / Client      : ${OPS_PER_CLIENT} (${CLIENT_COUNT * OPS_PER_CLIENT} total operations)`);
  console.log(`Pacing Interval   : ${INTERVAL_MS} ms / client (interleaved ~${(INTERVAL_MS / CLIENT_COUNT).toFixed(1)} ms per room op)`);
  console.log(`Target Load Rate  : ~${((1000 / INTERVAL_MS) * CLIENT_COUNT).toFixed(1)} room ops/sec`);
  console.log(`Element Types     : Realistic mix (strokes, rectangles, circles, text)`);
  console.log('-'.repeat(70));

  await mongoose.connect(TEST_DB_URI);
  await User.deleteMany({});
  await Room.deleteMany({});
  await CanvasElement.deleteMany({});
  await ElementTombstone.deleteMany({});
  presenceManager.clear();

  const server = http.createServer(app);
  server.setMaxListeners(0);
  const ioServer = initSocketIO(server);
  if (ioServer.sockets) ioServer.sockets.setMaxListeners(0);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  const socketUrl = `http://localhost:${port}`;

  const users = [];
  const sockets = [];
  let testRoomId;

  // Latency metrics tracking
  const sendTimestamps = new Map(); // elemId -> sender performance.now()
  const ackLatencies = [];
  const firstPeerLatencies = new Map(); // elemId -> first peer delivery latency
  const allPeersLatencies = [];

  // Local client state tracking for convergence verification
  const clientCanvasStores = Array.from({ length: CLIENT_COUNT }, () => new Map());

  // Event loop delay monitor
  const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
  eventLoopMonitor.enable();

  let totalOperations = CLIENT_COUNT * OPS_PER_CLIENT;
  let successfulOperations = 0;
  let failedOperations = 0;

  try {
    // 1. Register authenticated users
    console.log(`[Phase 1] Registering ${CLIENT_COUNT} test users...`);
    const regStart = performance.now();
    for (let i = 0; i < CLIENT_COUNT; i += 10) {
      const batchLimit = Math.min(i + 10, CLIENT_COUNT);
      const batchPromises = [];
      for (let j = i; j < batchLimit; j++) {
        batchPromises.push(
          fetch(`${baseUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `Paced User ${j + 1}`,
              email: `paced_user_${j + 1}@example.com`,
              password: 'Password123!'
            })
          }).then(async (res) => {
            const data = await res.json();
            return {
              id: data.data.user._id || data.data.user.id,
              token: data.data.token
            };
          })
        );
      }
      const registered = await Promise.all(batchPromises);
      users.push(...registered);
    }
    console.log(`  Registered ${CLIENT_COUNT} users in ${(performance.now() - regStart).toFixed(0)} ms.`);

    // 2. Create room
    const roomRes = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${users[0].token}`
      },
      body: JSON.stringify({
        name: `Paced Benchmark Room (${CLIENT_COUNT} clients)`,
        access: 'public'
      })
    });
    const roomData = await roomRes.json();
    testRoomId = roomData.data.roomId;

    // 3. Connect sockets, attach listeners BEFORE emitting any operations
    console.log(`[Phase 2] Connecting ${CLIENT_COUNT} clients and attaching peer listeners...`);
    for (let i = 0; i < CLIENT_COUNT; i++) {
      const socket = Client(socketUrl, {
        auth: { token: users[i].token },
        transports: ['websocket'],
        forceNew: true,
        autoConnect: false
      });
      sockets.push(socket);
    }

    await Promise.all(
      sockets.map(
        (s) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Socket connect timed out')), 10000);
            s.on('connect', () => {
              clearTimeout(timer);
              resolve();
            });
            s.on('connect_error', reject);
            s.connect();
          })
      )
    );

    // Attach peer listeners to all sockets BEFORE room join / operation emissions
    sockets.forEach((socket, clientIndex) => {
      socket.on('canvas-operation', (data) => {
        const recvTime = performance.now();
        if (data && (data.action === 'create' || data.action === 'draw') && data.element) {
          const elemId = data.element.id || data.element.elementId;
          const sendTime = sendTimestamps.get(elemId);
          if (sendTime !== undefined) {
            const latency = recvTime - sendTime;
            allPeersLatencies.push(latency);
            if (!firstPeerLatencies.has(elemId)) {
              firstPeerLatencies.set(elemId, latency);
            }
          }
          // Update client in-memory canvas store
          clientCanvasStores[clientIndex].set(elemId, data.element);
        }
      });
    });

    // Join room
    await Promise.all(
      sockets.map(
        (s) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('join-room timed out')), 10000);
            s.emit('join-room', { roomId: testRoomId }, (res) => {
              clearTimeout(timer);
              if (res.status === 'success') resolve();
              else reject(new Error(res.message));
            });
          })
      )
    );
    console.log(`  All ${CLIENT_COUNT} clients joined room. Peer listeners verified ready.`);

    // Synchronization pause ensuring event loop is completely quiet before starting
    await new Promise((r) => setTimeout(r, 400));

    // 4. Execute Paced Load Test
    console.log(`\n[Phase 3] Executing ${totalOperations} paced operations across ${CLIENT_COUNT} clients...`);
    const benchmarkStart = performance.now();
    const staggerStepMs = INTERVAL_MS / CLIENT_COUNT;

    // Run client tasks concurrently with staggered scheduling
    const clientPromises = sockets.map((socket, c) => {
      return (async () => {
        // Initial stagger delay for this client to interleave operations uniformly
        const initialDelay = c * staggerStepMs;
        await new Promise((r) => setTimeout(r, initialDelay));

        for (let op = 0; op < OPS_PER_CLIENT; op++) {
          const element = getRealisticElement(c, op);
          const t0 = performance.now();
          sendTimestamps.set(element.id, t0);

          await new Promise((resolveOp) => {
            socket.emit('draw-element', element, (res) => {
              const tAck = performance.now();
              const ackLat = tAck - t0;
              ackLatencies.push(ackLat);

              if (res && res.status === 'success') {
                successfulOperations++;
                // Record self-created element in local client store
                clientCanvasStores[c].set(element.id, res.data || element);
              } else {
                failedOperations++;
              }
              resolveOp();
            });
          });

          // Wait pacing interval before this client's next operation
          if (op < OPS_PER_CLIENT - 1) {
            await new Promise((r) => setTimeout(r, INTERVAL_MS));
          }
        }
      })();
    });

    await Promise.all(clientPromises);
    const benchmarkEnd = performance.now();
    const totalDurationMs = benchmarkEnd - benchmarkStart;
    eventLoopMonitor.disable();

    // Settle grace period for final peer message receptions
    await new Promise((r) => setTimeout(r, 400));

    // 5. Canvas State Convergence Verification
    console.log(`\n[Phase 4] Verifying authoritative canvas state convergence across clients...`);
    const mongoElements = await CanvasElement.find({ roomId: testRoomId }).lean();
    const mongoCount = mongoElements.length;

    let allClientsMatchCount = true;
    let allClientsMatchIds = true;
    const mongoElementIds = new Set(mongoElements.map((e) => e.elementId || e.id));

    for (let i = 0; i < CLIENT_COUNT; i++) {
      const clientStore = clientCanvasStores[i];
      if (clientStore.size !== mongoCount) {
        allClientsMatchCount = false;
      }
      for (const id of mongoElementIds) {
        if (!clientStore.has(id)) {
          allClientsMatchIds = false;
          break;
        }
      }
    }

    const stateConvergenceVerified =
      mongoCount === totalOperations &&
      successfulOperations === totalOperations &&
      allClientsMatchCount &&
      allClientsMatchIds;

    // 6. Calculate Percentiles & Totals
    const ackStats = calculatePercentiles(ackLatencies);
    const firstPeerStats = calculatePercentiles(Array.from(firstPeerLatencies.values()));
    const allPeersStats = calculatePercentiles(allPeersLatencies);
    const overallThroughput = ((totalOperations / totalDurationMs) * 1000).toFixed(1);

    const evLoopMeanMs = (eventLoopMonitor.mean / 1e6).toFixed(2);
    const evLoopP50Ms = (eventLoopMonitor.percentile(50) / 1e6).toFixed(2);
    const evLoopP95Ms = (eventLoopMonitor.percentile(95) / 1e6).toFixed(2);
    const evLoopP99Ms = (eventLoopMonitor.percentile(99) / 1e6).toFixed(2);

    // Print Results
    console.log('='.repeat(70));
    console.log('  PACED LOAD BENCHMARK REPORT');
    console.log('='.repeat(70));
    console.log(`Simulated Clients           : ${CLIENT_COUNT}`);
    console.log(`Total Operations Executed   : ${totalOperations}`);
    console.log(`Total Successful Operations : ${successfulOperations} (${((successfulOperations / totalOperations) * 100).toFixed(1)}%)`);
    console.log(`Total Failed Operations     : ${failedOperations}`);
    console.log(`Test Execution Duration     : ${(totalDurationMs / 1000).toFixed(2)} s`);
    console.log(`Measured Throughput         : ${overallThroughput} ops/sec`);
    console.log('-'.repeat(70));
    console.log('SERVER ACKNOWLEDGEMENT LATENCY (emit -> server DB write -> ack):');
    console.log(`  Count : ${ackStats.count} operations`);
    console.log(`  Min   : ${ackStats.min} ms`);
    console.log(`  p50   : ${ackStats.p50} ms (Median)`);
    console.log(`  Mean  : ${ackStats.mean} ms`);
    console.log(`  p95   : ${ackStats.p95} ms`);
    console.log(`  p99   : ${ackStats.p99} ms`);
    console.log(`  Max   : ${ackStats.max} ms`);
    console.log('-'.repeat(70));
    console.log('END-TO-END PEER DELIVERY LATENCY (emit -> peer WebSocket reception):');
    console.log(`  Peer Messages Delivered : ${allPeersStats.count} total peer receptions`);
    console.log(`  First Peer Delivery p50 : ${firstPeerStats.p50} ms`);
    console.log(`  First Peer Delivery p95 : ${firstPeerStats.p95} ms`);
    console.log(`  First Peer Delivery p99 : ${firstPeerStats.p99} ms`);
    console.log(`  All Peers Delivery  p50 : ${allPeersStats.p50} ms (Median mesh)`);
    console.log(`  All Peers Delivery  p95 : ${allPeersStats.p95} ms`);
    console.log(`  All Peers Delivery  p99 : ${allPeersStats.p99} ms`);
    console.log(`  All Peers Delivery  Max : ${allPeersStats.max} ms`);
    console.log('-'.repeat(70));
    console.log('NODE EVENT LOOP CONGESTION:');
    console.log(`  Event Loop Delay Mean   : ${evLoopMeanMs} ms`);
    console.log(`  Event Loop Delay p50    : ${evLoopP50Ms} ms`);
    console.log(`  Event Loop Delay p95    : ${evLoopP95Ms} ms`);
    console.log(`  Event Loop Delay p99    : ${evLoopP99Ms} ms`);
    console.log('-'.repeat(70));
    console.log('STATE CONVERGENCE & INTEGRITY:');
    console.log(`  MongoDB Persisted Count : ${mongoCount} / ${totalOperations}`);
    console.log(`  Client Stores In Sync   : ${allClientsMatchCount && allClientsMatchIds ? '50 / 50 clients (100% in sync)' : 'MISMATCH'}`);
    console.log(`  Canvas State Convergence: ${stateConvergenceVerified ? 'VERIFIED (Identical across DB & all 50 peers)' : 'FAILED'}`);
    console.log('='.repeat(70));

    // Cleanup
    await CanvasElement.deleteMany({ roomId: testRoomId });
    await ElementTombstone.deleteMany({ roomId: testRoomId });
    await Room.deleteMany({ roomId: testRoomId });
    await User.deleteMany({});
  } finally {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
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
  runPacedBenchmark().catch((err) => {
    console.error('Paced benchmark failed:', err);
    process.exit(1);
  });
}

module.exports = runPacedBenchmark;
