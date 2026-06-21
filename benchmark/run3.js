#!/usr/bin/env node
/**
 * Full profile suite: starts server, connects bots via patched protocol, profiles.
 * Monkey-patches minecraft-data to bridge 26.2 → 1.21.11 data,
 * overrides protocol version to 776.
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const HOME = process.env.HOME;

// ── Config ──
const CPU_PROFILE_S = parseInt(process.argv[2]) || 20;
const BOT_COUNT = parseInt(process.argv[3]) || 8;
const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-26.2.local-SNAPSHOT.jar');
const ASPROF = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
const WORK = `/tmp/nsb-${Date.now()}`;
const OUT = '/tmp/nsb';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'), 'online-mode=false\nserver-port=25565\n');

// ── Patch minecraft-data for 26.2 → 1.21.11 ──
const mcData = require('minecraft-data');
const data21_11 = mcData('1.21.11');
const origMcData = mcData;
// Replace the module.exports
const mcDataModule = require.cache[require.resolve('minecraft-data')];
mcDataModule.exports = function patchedMcData(ver, preNetty) {
  const v = String(ver).replace('pe_', 'bedrock_');
  // If the version starts with 26, use 1.21.11 data
  if (v === '26.2' || v === '26' || v.startsWith('26.')) {
    const result = origMcData('1.21.11', preNetty);
    if (result) {
      result.version.minecraftVersion = v;
      result.version.version = 776;
    }
    return result;
  }
  return origMcData(ver, preNetty);
};
Object.assign(mcDataModule.exports, mcData);
console.log('[patch] minecraft-data patched: 26.2 → 1.21.11 data, proto 776');

// ── Start server ──
const sv = spawn(JAVA, ['-Xms512M', '-Xmx1G', '-jar', JAR, '--nogui'], {
  cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'],
});
let ready = false;
const log = [];
sv.stdout.on('data', d => { const t = d.toString(); log.push(t); if (t.includes('Done (') && !ready) { ready = true; setTimeout(connectBots, 2000); } });
sv.stderr.on('data', d => {});
setTimeout(() => { if (!ready) { console.error('[FAIL] Server timeout'); sv.kill(); process.exit(1); } }, 40000);

// ── Patch protocol version after mineflayer creates client ──
const mineflayer = require('mineflayer');
const bots = [];

function connectBots() {
  console.log(`[bots] Connecting ${BOT_COUNT}...`);
  for (let i = 1; i <= BOT_COUNT; i++) {
    try {
      const bot = mineflayer.createBot({
        host: '127.0.0.1', port: 25565,
        username: `B${i}`,
        auth: 'offline',
        // version not set → version: false → auto-version
      });
      
      // After auto-version but before connect, patch protocol to 776
      const protoDesc = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(bot._client), 'protocolVersion'
      );
      
      bot.once('login', () => process.stdout.write(`+${i} `));
      bot.on('error', (e) => process.stdout.write(`e${i} `));
      bot.on('end', () => {});
      bots.push(bot);
    } catch(e) { process.stdout.write(`x${i} `); }
  }
  process.stdout.write('\n');
  setTimeout(doProfiles, 8000);
}

function doProfiles() {
  const connected = bots.filter(b => b && b.entity).length;
  const pid = sv.pid;
  console.log(`[profile] ${connected}/${BOT_COUNT} connected, PID ${pid}`);

  // CPU flat
  console.log(`\n=== CPU FLAT (${CPU_PROFILE_S}s) ===`);
  try {
    const f = path.join(OUT, 'cpu_flat.txt');
    execFileSync(ASPROF, ['-d', String(CPU_PROFILE_S), '-f', f, '-o', 'flat', String(pid)], { timeout: CPU_PROFILE_S * 1000 + 10000 });
    console.log(fs.readFileSync(f, 'utf8').split('\n').slice(0, 60).join('\n'));
  } catch(e) { console.error(`  ${e.message}`); }

  // Alloc flat
  console.log('\n=== ALLOC FLAT (10s) ===');
  try {
    const f = path.join(OUT, 'alloc_flat.txt');
    execFileSync(ASPROF, ['-d', '10', '-f', f, '-o', 'flat', '-e', 'alloc', String(pid)], { timeout: 20000 });
    console.log(fs.readFileSync(f, 'utf8').split('\n').slice(0, 40).join('\n'));
  } catch(e) { console.error(`  ${e.message}`); }

  // Cleanup
  console.log('\n[cleanup]');
  bots.forEach(b => { try { b.end(); } catch(e) {} });
  sv.kill('SIGTERM');
  setTimeout(() => process.exit(0), 3000);
}
