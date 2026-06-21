#!/usr/bin/env node
/**
 * Bot connector: patches modules to bridge 26.2 → 1.21.11.
 * Load order: patch mc-data → load registry → patch registry → load mineflayer → connect.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const HOME = process.env.HOME;

// ── 1. Patch minecraft-data FIRST ──
const mcData = require('minecraft-data');
const origMcData = mcData;  // keep original function
const mcDataCache = require.cache[require.resolve('minecraft-data')];
const data21_11 = origMcData('1.21.11');

mcDataCache.exports = function patchedMc(ver, pn) {
  const v = String(ver);
  if (v === '26.2' || v.startsWith('26.')) {
    const result = origMcData('1.21.11', pn);
    if (result) {
      result.version = {...result.version, minecraftVersion: v, version: 776};
      result.type = 'pc';
    }
    return result;
  }
  if (v === '776') return patchedMc('26.2', pn);
  return origMcData(ver, pn);
};
Object.assign(mcDataCache.exports, mcData);  // copy static props

// ── 2. Now load & patch prismarine-registry ──
const origReg = require('prismarine-registry');
const regCache = require.cache[require.resolve('prismarine-registry')];
regCache.exports = (version) => {
  if (version === '26.2' || version === '776' || String(version).startsWith('26.')) {
    return origReg('1.21.11');
  }
  return origReg(version);
};

// ── 3. Start server ──
fs.rmSync('/tmp/nsb3', { recursive: true, force: true });
fs.mkdirSync('/tmp/nsb3', { recursive: true });
fs.writeFileSync('/tmp/nsb3/eula.txt', 'eula=true\n');
fs.writeFileSync('/tmp/nsb3/server.properties', 'online-mode=false\nserver-port=25565\n');

console.log('[server] Starting...');
const sv = spawn(path.join(HOME, 'tools/jdk-25.0.3+9/bin/java'),
  ['-Xms512M', '-Xmx1G', '-jar',
   path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar'), '--nogui'],
  { cwd: '/tmp/nsb3', stdio: ['pipe', 'pipe', 'pipe'] });
let ready = false;
sv.stdout.on('data', d => {
  const t = d.toString();
  if (t.includes('Done (') && !ready) {
    ready = true;
    console.log('[server] Ready\n');
    setTimeout(connect, 1500);
  }
});
sv.stderr.on('data', d => {});
setTimeout(() => { if (!ready) { console.error('[FAIL] Server timeout'); cleanup(); process.exit(1); } }, 40000);

function cleanup() {
  try { sv.kill('SIGTERM'); } catch(e) {}
  setTimeout(() => { try { sv.kill('SIGKILL'); } catch(e) {} process.exit(0); }, 3000);
}

function connect() {
  const mineflayer = require('mineflayer');
  
  // Test with exact version 26.2
  console.log('[bot] Trying mineflayer with 26.2...');
  const bot = mineflayer.createBot({
    host: '127.0.0.1', port: 25565,
    username: 'TestBot1',
    auth: 'offline',
    version: '26.2',
  });
  
  bot.on('login', () => console.log('[bot] LOGIN'));
  bot.on('spawn', () => console.log('[bot] SPAWN'));
  bot.on('error', (e) => console.log('[bot] Error:', e.message));
  bot.on('kicked', (r) => console.log('[bot] Kicked:', r));
  bot.on('end', (r) => console.log('[bot] End:', r));
  
  setTimeout(() => {
    console.log(`[bot] Entity: ${!!bot.entity}, Players: ${bot.players ? Object.keys(bot.players).length : 0}`);
    if (bot.entity) {
      console.log('[bot] CONNECTED!');
    }
    cleanup();
  }, 15000);
}
