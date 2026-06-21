#!/usr/bin/env node
/**
 * Profile runner: starts server, connects bots, profiles, prints flat profile.
 * Must run from benchmark/ directory (needs local node_modules).
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DURATION = parseInt(process.argv[2]) || 20;
const BOT_COUNT = parseInt(process.argv[3]) || 10;

const HOME = process.env.HOME;
const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar');
const ASPROF = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
const WORK = `/tmp/nsprof-${Date.now()}`;
const OUT = '/tmp/nsprofile';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'),
  'online-mode=false\nserver-port=25565\n' +
  'simulation-distance=4\nview-distance=5\n');

console.log(`[setup] Server dir: ${WORK}`);
console.log(`[setup] Starting server...`);

const sv = spawn(JAVA, ['-Xms512M', '-Xmx1G', '-jar', JAR, '--nogui'], {
  cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'],
});
let ready = false;
const svlog = [];
sv.stdout.on('data', d => {
  const t = d.toString();
  svlog.push(t);
  if (t.includes('Done (') && !ready) {
    ready = true;
    console.log('[server] Ready');
    setTimeout(connectBots, 2000);
  }
});
sv.stderr.on('data', d => {});
setTimeout(() => { if (!ready) { console.error('[FAIL] Server not ready'); sv.kill(); process.exit(1); } }, 40000);

const mineflayer = require('mineflayer');
const bots = [];

function connectBots() {
  console.log(`[bots] Connecting ${BOT_COUNT} bots...`);
  for (let i = 1; i <= BOT_COUNT; i++) {
    try {
      const b = mineflayer.createBot({
        host: '127.0.0.1', port: 25565,
        username: `${i}`, auth: 'offline', version: '1.21.5'
      });
      b.on('login', () => process.stdout.write(`+${i} `));
      b.on('error', (e) => process.stdout.write(`e${i} `));
      b.on('end', () => {});
      bots.push(b);
    } catch(e) { process.stdout.write(`x${i} `); }
  }
  process.stdout.write('\n');
  setTimeout(profile, 5000);
}

function profile() {
  const pid = sv.pid;
  const connected = bots.filter(b => b && b.entity).length;
  console.log(`[profile] ${connected}/${BOT_COUNT} bots connected`);
  console.log(`[profile] PID: ${pid}`);

  // CPU flat
  console.log(`\n=== CPU FLAT (${DURATION}s) ===`);
  try {
    const flatFile = path.join(OUT, `cpu_flat_${DURATION}s.txt`);
    execFileSync(ASPROF, ['-d', String(DURATION), '-f', flatFile, '-o', 'flat', String(pid)], { timeout: DURATION * 1000 + 10000 });
    const data = fs.readFileSync(flatFile, 'utf8');
    const lines = data.split('\n').filter(l => l.trim());
    console.log(lines.slice(0, 60).join('\n'));
  } catch(e) { console.error(`[error] ${e.message}`); }

  // Alloc flat
  console.log(`\n=== ALLOC FLAT (10s) ===`);
  try {
    const allocFile = path.join(OUT, 'alloc_flat_10s.txt');
    execFileSync(ASPROF, ['-d', '10', '-f', allocFile, '-o', 'flat', '-e', 'alloc', String(pid)], { timeout: 20000 });
    console.log(fs.readFileSync(allocFile, 'utf8').split('\n').slice(0, 40).join('\n'));
  } catch(e) { console.error(`[error] ${e.message}`); }

  // Flamegraph
  console.log(`\n=== CPU FLAMEGRAPH (${DURATION}s) ===`);
  try {
    const fg = path.join(OUT, `cpu_${DURATION}s.html`);
    execFileSync(ASPROF, ['-d', String(DURATION), '-f', fg, '-o', 'flamegraph', String(pid)], { timeout: DURATION * 1000 + 10000 });
    console.log(`  ${fg}`);
  } catch(e) { console.error(`[error] ${e.message}`); }

  // Read server log for TPS
  const logFile = path.join(WORK, 'logs/latest.log');
  if (fs.existsSync(logFile)) {
    const log = fs.readFileSync(logFile, 'utf8');
    const msptLines = log.split('\n').filter(l => l.includes('ms per tick'));
    const tpsLines = log.split('\n').filter(l => l.includes('tps'));
    if (msptLines.length > 0) console.log('\n=== Servertick ===\n' + msptLines.slice(-5).join('\n'));
    if (tpsLines.length > 0) console.log(tpsLines.slice(-5).join('\n'));
  }

  // Cleanup
  bots.forEach(b => { try { b.end(); } catch(e) {} });
  sv.kill('SIGTERM');
  setTimeout(() => { console.log('\n[done]'); process.exit(0); }, 3000);
}
