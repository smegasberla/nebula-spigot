#!/usr/bin/env node
/**
 * Nebula Benchmark Runner
 *
 * Runs the server, connects bots, profiles with async-profiler, collects metrics.
 * Usage: node benchmark-runner.js [duration_seconds] [bot_count]
 */
const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const DURATION = parseInt(process.argv[2]) || 60;
const BOT_COUNT = parseInt(process.argv[3]) || 10;
const NEBULA_DIR = path.resolve(__dirname, '..');
const JAVA_HOME = process.env.JAVA_HOME || path.join(process.env.HOME, 'tools/jdk-25.0.3+9');
const JAR = path.join(NEBULA_DIR, 'leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar');
const ASPROF = path.join(process.env.HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');

const WORK_DIR = path.join('/tmp', `nebula-bench-${Date.now()}`);

// 1. Setup
console.log(`[*] Benchmark dir: ${WORK_DIR}`);
fs.mkdirSync(WORK_DIR, { recursive: true });
fs.writeFileSync(path.join(WORK_DIR, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK_DIR, 'server.properties'),
  'online-mode=false\nserver-port=25565\n'
);

// 2. Start server
console.log('[*] Starting server...');
const server = spawn(path.join(JAVA_HOME, 'bin/java'),
  ['-Xms512M', '-Xmx1G',
   '-jar', JAR, '--nogui'],
  { cwd: WORK_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
);

let serverReady = false;
const serverLog = [];

server.stdout.on('data', d => {
  const lines = d.toString();
  serverLog.push(lines);
  if (lines.includes('Done (') && !serverReady) {
    serverReady = true;
    console.log('[+] Server ready');
    runLoadTest();
  }
});
server.stderr.on('data', d => serverLog.push(d.toString()));

server.on('exit', (code) => {
  console.log(`[*] Server exited with code ${code}`);
});

// Wait max 30s for server
setTimeout(() => {
  if (!serverReady) {
    console.error('[!] Server failed to start within 30s');
    server.kill();
    process.exit(1);
  }
}, 30000);

// 3. Load test
function runLoadTest() {
  console.log(`[*] Connecting ${BOT_COUNT} bots...`);
  const bots = [];

  function createBot(id) {
    try {
      const mineflayer = require('mineflayer');
      const bot = mineflayer.createBot({
        host: 'localhost',
        port: 25565,
        username: `LoadBot_${id}`,
        version: '1.21.5',
        auth: 'offline',
      });
      bot.on('login', () => {
        console.log(`  [+] Bot ${id} joined`);
        bot.chat(`/tp @r ~ ~ ~`);
      });
      bot.on('move', () => {});
      bot.on('error', (e) => { if (e.code !== 'ECONNRESET') console.error(`  [!] Bot ${id}: ${e.message}`); });
      bot.on('end', () => {});
      return bot;
    } catch (e) {
      console.error(`[!] Failed to create bot ${id}: ${e.message}`);
      return null;
    }
  }

  for (let i = 1; i <= BOT_COUNT; i++) {
    setTimeout(() => {
      const bot = createBot(i);
      if (bot) bots.push(bot);
    }, i * 300);
  }

  // Wait for bots, then profile
  setTimeout(() => {
    const connected = bots.filter(b => b && b.entity).length;
    console.log(`[*] ${connected}/${BOT_COUNT} bots connected`);

    if (connected === 0) {
      console.log('[!] No bots connected. Continuing with profile anyway.');
    }

    // 4. Profile
    profile();
  }, 15000);
}

// 4. Profile
async function profile() {
  const outDir = path.join(WORK_DIR, 'profiles');
  fs.mkdirSync(outDir, { recursive: true });
  const pid = server.pid;

  console.log(`[*] Profiling server PID ${pid} for ${DURATION}s...`);

  // CPU profile
  console.log('  CPU profile...');
  try {
    execSync(`"${ASPROF}" -d ${DURATION} -f "${outDir}/cpu.svg" -e cpu -i 1ms ${pid}`, { timeout: DURATION * 1000 + 5000 });
  } catch (e) {
    console.error(`  [!] CPU profile failed: ${e.message}`);
  }

  // Short allocation profile
  console.log('  Allocation profile...');
  try {
    execSync(`"${ASPROF}" -d 20 -f "${outDir}/alloc.svg" -e alloc -i 1ms ${pid}`, { timeout: 30000 });
  } catch (e) {
    console.error(`  [!] Alloc profile failed: ${e.message}`);
  }

  // Lock profile
  console.log('  Lock profile...');
  try {
    execSync(`"${ASPROF}" -d 20 -f "${outDir}/lock.svg" -e lock -i 1ms ${pid}`, { timeout: 30000 });
  } catch (e) {
    console.error(`  [!] Lock profile failed: ${e.message}`);
  }

  // Collect TPS from server log
  const tpsData = serverLog.join('\n');
  const msptMatches = [...tpsData.matchAll(/[0-9.]+ ms per tick/g)];
  const tpsMatches = [...tpsData.matchAll(/[0-9.]+ tps/g)];

  // 5. Summary
  console.log('\n=== Benchmark Summary ===');
  console.log(`Duration: ${DURATION}s`);
  console.log(`Bots: ${BOT_COUNT}`);
  console.log(`Profiles: ${outDir}`);
  console.log(`Server log: ${path.join(WORK_DIR, 'logs/latest.log')}`);

  // 6. Cleanup
  console.log('[*] Stopping server...');
  server.kill('SIGTERM');
  setTimeout(() => {
    try { server.kill('SIGKILL'); } catch(e) {}
    console.log('[*] Done');
    process.exit(0);
  }, 5000);
}
