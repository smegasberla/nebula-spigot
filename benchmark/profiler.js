#!/usr/bin/env node
/**
 * Profiler: starts Leaf server, generates load via console commands,
 * profiles with async-profiler, prints CPU hotspots.
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const HOME = process.env.HOME;

const CPU_S = parseInt(process.argv[2]) || 25;
const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar');
const ASPROF = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
const WORK = `/tmp/nsload-${Date.now()}`;
const OUT = '/tmp/nsload';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'),
  'online-mode=false\nserver-port=25565\n');

console.log(`[setup] Server: ${WORK}`);
const sv = spawn(JAVA, ['-Xms512M', '-Xmx1G', '-jar', JAR, '--nogui'], {
  cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'],
});
let ready = false;
const cmdQueue = [];

function consoleCmd(cmd) {
  if (ready) sv.stdin.write(cmd + '\n');
  else cmdQueue.push(cmd);
}

sv.stdout.on('data', d => {
  const t = d.toString();
  process.stdout.write(t);
  if (t.includes('Done (') && !ready) {
    ready = true;
    // Drain queued commands
    for (const c of cmdQueue) sv.stdin.write(c + '\n');
    cmdQueue.length = 0;
    // Wait for world load, then start
    setTimeout(phase1, 5000);
  }
});
sv.stderr.on('data', d => {});

setTimeout(() => { if (!ready) { console.error('[FAIL]'); cleanup(); process.exit(1); } }, 40000);

function cleanup() {
  try { sv.kill('SIGTERM'); } catch(e) {}
  setTimeout(() => { try { sv.kill('SIGKILL'); } catch(e) {} process.exit(0); }, 3000);
}

function phase1() {
  const pid = sv.pid;
  console.log(`\n=== Phase 1: Idle CPU profile (15s) ===`);
  try {
    execFileSync(ASPROF, ['-d', '15', '-f', `${OUT}/cpu_idle.html`, '-o', 'flamegraph', String(pid)], { timeout: 25000 });
    console.log(`  cpu_idle.html done`);
  } catch(e) { console.error(`  ${e.message}`); }
  phase2();
}

function phase2() {
  console.log(`\n=== Phase 2: Spawning load entities ===`);
  // Spawn chickens for entity AI load
  const spawns = ['100', '200', '500', '1000', '2000'];
  let i = 0;
  function doSpawn() {
    if (i >= spawns.length) {
      // Wait for load to settle
      setTimeout(phase3, 5000);
      return;
    }
    const n = spawns[i];
    console.log(`  Spawning ${n} chickens...`);
    sv.stdin.write(`/summon minecraft:chicken ~ ~ ~\n`.repeat(parseInt(n)).slice(0, -1));
    i++;
    setTimeout(doSpawn, 100);
  }
  doSpawn();
}

function phase3() {
  const pid = sv.pid;
  console.log(`\n=== Phase 3: Loaded CPU profile (${CPU_S}s) ===`);
  sv.stdin.write('/tps\n');
  try {
    execFileSync(ASPROF, ['-d', String(CPU_S), '-f', `${OUT}/cpu_loaded.html`, '-o', 'flamegraph', String(pid)], { timeout: CPU_S * 1000 + 10000 });
    console.log(`  cpu_loaded.html done`);
  } catch(e) { console.error(`  ${e.message}`); }
  sv.stdin.write('/tps\n');
  sv.stdin.write('/spark health\n');
  setTimeout(phase4, 1000);
}

function phase4() {
  const pid = sv.pid;
  console.log(`\n=== Phase 4: Flat profile ===`);
  try {
    execFileSync(ASPROF, ['-d', '10', '-f', `${OUT}/cpu_flat.txt`, '-o', 'flat', String(pid)], { timeout: 20000 });
    const data = fs.readFileSync(`${OUT}/cpu_flat.txt`, 'utf8').split('\n').slice(0, 80).join('\n');
    console.log(data);
  } catch(e) { console.error(`  ${e.message}`); }
  finish();
}

function finish() {
  sv.stdin.write('/stop\n');
  setTimeout(() => {
    // Read TPS from log
    const logFile = path.join(WORK, 'logs/latest.log');
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf8');
      const tpsLines = log.split('\n').filter(l => l.includes('tps') && !l.includes('player'));
      const tps = log.match(/(\d+\.?\d*) tps/g);
      const mspt = log.match(/(\d+\.?\d*) ms per tick/g);
      if (tps) console.log('\nTPS:', tps.slice(-5));
      if (mspt) console.log('MSPT:', mspt.slice(-5));
      // Print any spark output
      const spark = log.split('\n').filter(l => l.includes('[spark]'));
      if (spark.length) console.log('\nSpark:', spark.slice(-5).join('\n'));
    }
    console.log(`\nProfiles in: ${OUT}`);
    cleanup();
  }, 5000);
}
