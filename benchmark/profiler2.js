#!/usr/bin/env node
/**
 * Load profiler: spawns entities, profiles with async-profiler.
 * Console-based entity spawning (no bot library needed).
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const HOME = process.env.HOME;
const CPU_S = parseInt(process.argv[2]) || 25;
const ENTITY_COUNT = parseInt(process.argv[3]) || 500;

const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar');
const ASPROF = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
const WORK = `/tmp/nsl-${Date.now()}`;
const OUT = '/tmp/nsl';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'),
  'online-mode=false\nserver-port=25565\nsimulation-distance=8\nview-distance=10\n');

console.log(`[setup] ${WORK}`);
let tpsData = [];

const sv = spawn(JAVA, ['-Xms512M', '-Xmx1G', '-jar', JAR, '--nogui'], {
  cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'],
});
let ready = false;

sv.stdout.on('data', d => {
  const t = d.toString();
  // Capture TPS lines
  if (t.includes('tps') || t.includes('ms per tick')) tpsData.push(t);
  // Print everything
  const lines = t.split('\n').filter(l => l);
  for (const l of lines.slice(0, 5)) process.stdout.write(l.substring(0, 120) + '\n');
  if (t.includes('Done (') && !ready) {
    ready = true;
    console.log('\n[server] Ready');
    setTimeout(spawnEntities, 3000);
  }
});
sv.stderr.on('data', d => {});

setTimeout(() => { if (!ready) { console.error('[FAIL]'); cleanup(); process.exit(1); } }, 40000);

function cleanup() {
  try { sv.kill('SIGTERM'); } catch(e) {}
  setTimeout(() => { try { sv.kill('SIGKILL'); } catch(e) {} process.exit(0); }, 3000);
}

function spawnEntities() {
  console.log(`[load] Spawning ${ENTITY_COUNT} chickens around spawn...`);
  // Batch spawn in a grid to distribute entities for performance
  const side = Math.ceil(Math.sqrt(ENTITY_COUNT));
  let spawned = 0;
  
  function batch() {
    if (spawned >= ENTITY_COUNT) {
      console.log('[load] Done spawning');
      sv.stdin.write('/tps\n');
      // Wait for entity loading
      setTimeout(profileIdle, 3000);
      return;
    }
    // Spawn a batch of 10 at offset coordinates
    let cmds = '';
    for (let b = 0; b < 10 && spawned < ENTITY_COUNT; b++) {
      const x = (spawned % side) - side/2;
      const z = Math.floor(spawned / side) - side/2;
      cmds += `/summon minecraft:chicken ${x} ~ ${z}\n`;
      spawned++;
    }
    sv.stdin.write(cmds);
    setImmediate(batch);
  }
  batch();
}

function profileIdle() {
  const pid = sv.pid;
  console.log(`\n=== Idle CPU (10s) ===`);
  try {
    execFileSync(ASPROF, ['-d', '10', '-f', `${OUT}/cpu_idle_flat.txt`, '-o', 'flat', String(pid)], { timeout: 20000 });
    const d = fs.readFileSync(`${OUT}/cpu_idle_flat.txt`, 'utf8').split('\n').slice(0, 50).join('\n');
    console.log(d);
  } catch(e) { console.error(`  ${e.message}`); }
  
  sv.stdin.write('/tps\n');
  setTimeout(() => profileLoaded(), 2000);
}

function profileLoaded() {
  const pid = sv.pid;
  console.log(`\n=== Loaded CPU (${CPU_S}s) ===`);
  // Let entities spread
  sv.stdin.write('/tps\n');
  
  try {
    execFileSync(ASPROF, ['-d', String(CPU_S), '-f', `${OUT}/cpu_loaded_flat.txt`, '-o', 'flat', String(pid)], { timeout: CPU_S * 1000 + 10000 });
    const d = fs.readFileSync(`${OUT}/cpu_loaded_flat.txt`, 'utf8').split('\n').slice(0, 80).join('\n');
    console.log(d);
  } catch(e) { console.error(`  ${e.message}`); }
  
  // Flamegraph
  console.log(`\n=== Loaded Flamegraph (15s) ===`);
  try {
    execFileSync(ASPROF, ['-d', '15', '-f', `${OUT}/cpu_loaded.html`, '-o', 'flamegraph', String(pid)], { timeout: 25000 });
    console.log(`  ${OUT}/cpu_loaded.html`);
  } catch(e) { console.error(`  ${e.message}`); }
  
  sv.stdin.write('/tps\n');
  sv.stdin.write('/stop\n');
  
  setTimeout(() => {
    // Read TPS from log
    const logFile = path.join(WORK, 'logs/latest.log');
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf8');
      const tps = [...log.matchAll(/(\d+\.?\d*) tps/g)].slice(-5).map(m => m[1]);
      const mspt = [...log.matchAll(/(\d+\.?\d*) ms per tick/g)].slice(-5).map(m => m[1]);
      if (tps.length) console.log('\nTPS:', tps.join(', '));
      if (mspt.length) console.log('MSPT:', mspt.join(', '));
    }
    console.log(`\nProfiles: ${OUT}`);
    cleanup();
  }, 5000);
}
