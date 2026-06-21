#!/usr/bin/env node
/**
 * Profile runner: starts server, connects bots, profiles with async-profiler.
 * Uses version: false for auto-detect.
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DURATION = parseInt(process.argv[2]) || 20;
const BOT_COUNT = parseInt(process.argv[3]) || 10;

const HOME = process.env.HOME;
const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-26.2.local-SNAPSHOT.jar');
const ASPROF = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
const WORK = `/tmp/nsprof2-${Date.now()}`;
const OUT = '/tmp/nsprofile2';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'),
  'online-mode=false\nserver-port=25565\n');

console.log(`[setup] ${WORK}`);
const sv = spawn(JAVA, ['-Xms512M', '-Xmx1G', '-jar', JAR, '--nogui'], {
  cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'],
});
let ready = false;
sv.stdout.on('data', d => {
  const t = d.toString();
  if (t.includes('Done (') && !ready) {
    ready = true;
    console.log('[server] Ready');
    setTimeout(connectBots, 2000);
  }
});
sv.stderr.on('data', d => {});
setTimeout(() => { if (!ready) { console.error('[FAIL]'); sv.kill(); process.exit(1); } }, 40000);

const mineflayer = require('mineflayer');
const bots = [];

function connectBots() {
  console.log(`[bots] ${BOT_COUNT}...`);
  for (let i = 1; i <= BOT_COUNT; i++) {
    try {
      const b = mineflayer.createBot({
        host: '127.0.0.1', port: 25565,
        username: `B${i}`,
        auth: 'offline',
      });
      b.on('login', () => process.stdout.write(`+${i} `));
      b.on('error', (e) => process.stdout.write(`e${i}:${e.message.slice(0,20)} `));
      b.on('end', () => {});
      bots.push(b);
    } catch(e) { process.stdout.write(`x${i} `); }
  }
  process.stdout.write('\n');
  setTimeout(() => {
    const connected = bots.filter(b => b && b.entity).length;
    console.log(`[profile] ${connected}/${BOT_COUNT} connected`);

    // Try profiling even if no bots
    const pid = sv.pid;

    // CPU flat
    console.log(`\n=== CPU FLAT (${DURATION}s) ===`);
    try {
      const flatFile = path.join(OUT, `cpu_flat.txt`);
      execFileSync(ASPROF, ['-d', String(DURATION), '-f', flatFile, '-o', 'flat', String(pid)], { timeout: DURATION * 1000 + 10000 });
      const d = fs.readFileSync(flatFile, 'utf8').split('\n').filter(l => l.trim());
      console.log(d.slice(0, 60).join('\n'));
    } catch(e) { console.error(`  ${e.message}`); }

    // Alloc flat
    console.log('\n=== ALLOC FLAT (10s) ===');
    try {
      const f = path.join(OUT, 'alloc_flat.txt');
      execFileSync(ASPROF, ['-d', '10', '-f', f, '-o', 'flat', '-e', 'alloc', String(pid)], { timeout: 20000 });
      console.log(fs.readFileSync(f, 'utf8').split('\n').slice(0, 40).join('\n'));
    } catch(e) { console.error(`  ${e.message}`); }

    // Cleanup
    bots.forEach(b => { try { b.end(); } catch(e) {} });
    sv.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000);
  }, 8000);
}
