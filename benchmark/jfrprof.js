#!/usr/bin/env node
/**
 * JFR profiler: uses JDK built-in JFR for profiling under heavy load.
 * No permissions issues (JFR is built into JDK 25).
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const HOME = process.env.HOME;

const CPU_S = parseInt(process.argv[2]) || 30;
const ENTITY_COUNT = parseInt(process.argv[3]) || 2000;
const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar');
const WORK = `/tmp/nsjfr-${Date.now()}`;
const OUT = '/tmp/nsjfr';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'),
  'online-mode=false\nserver-port=25565\nsimulation-distance=6\nview-distance=8\n');

console.log(`[setup] ${WORK}`);

// Start server with JFR enabled (-XX:StartFlightRecording)
const sv = spawn(JAVA, [
  '-Xms1G', '-Xmx2G',
  '-XX:StartFlightRecording=filename=/tmp/nsjfr/server.jfr,maxsize=500m,settings=profile',
  '-jar', JAR, '--nogui'
], { cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'] });

let ready = false;
sv.stdout.on('data', d => {
  const t = d.toString();
  const lines = t.split('\n').filter(l => l);
  for (const l of lines.slice(0, 2)) process.stdout.write(l.substring(0, 120) + '\n');
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
  setTimeout(() => { try { sv.kill('SIGKILL'); } catch(e) {} process.exit(0); }, 5000);
}

function spawnEntities() {
  console.log(`[load] Spawning ${ENTITY_COUNT} animals...`);
  let spawned = 0;
  const side = Math.ceil(Math.sqrt(ENTITY_COUNT));
  
  function batch() {
    if (spawned >= ENTITY_COUNT) {
      console.log('[load] Done spawning');
      setTimeout(profile, 5000);
      return;
    }
    // Batch of 5 per tick
    let cmds = '';
    for (let b = 0; b < 5 && spawned < ENTITY_COUNT; b++) {
      const x = (spawned % side) - side/2;
      const z = Math.floor(spawned / side) - side/2;
      cmds += `/summon minecraft:chicken ${Math.floor(x)} ~ ${Math.floor(z)}\n`;
      spawned++;
    }
    sv.stdin.write(cmds);
    setImmediate(batch);
  }
  batch();
}

function profile() {
  const pid = sv.pid;
  console.log(`[profile] PID ${pid}, profiling for ${CPU_S}s...`);
  
  // Get TPS before
  sv.stdin.write('/tps\n');
  
  // Use async-profiler with wall-clock sampling (doesn't need perf_events)
  // --wall uses a different mechanism than -e cpu, works without root
  const asprof = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
  
  console.log(`\n=== Wall clock CPU (${CPU_S}s) ===`);
  try {
    execFileSync(asprof, ['-d', String(CPU_S), '-f', `${OUT}/cpu_wall.html`, '--wall', '1ms', String(pid)], { timeout: CPU_S * 1000 + 10000 });
    console.log(`  ${OUT}/cpu_wall.html`);
  } catch(e) { console.error(`  wall: ${e.message}`); }
  
  // Also do a flat profile using wall clock
  console.log('\n=== Wall clock flat ===');
  try {
    execFileSync(asprof, ['-d', '10', '-f', `${OUT}/flat.txt`, '-o', 'flat', '--wall', '1ms', String(pid)], { timeout: 20000 });
    const d = fs.readFileSync(`${OUT}/flat.txt`, 'utf8').split('\n').slice(0, 80).join('\n');
    console.log(d);
  } catch(e) { console.error(`  flat: ${e.message}`); }
  
  // Alloc profile
  console.log('\n=== Alloc (10s) ===');
  try {
    const f = path.join(OUT, 'alloc.txt');
    execFileSync(asprof, ['-d', '10', '-f', f, '-o', 'flat', '-e', 'alloc', String(pid)], { timeout: 20000 });
    console.log(fs.readFileSync(f, 'utf8').split('\n').slice(0, 40).join('\n'));
  } catch(e) { console.error(`  alloc: ${e.message}`); }
  
  sv.stdin.write('/tps\n');
  sv.stdin.write('/save\n');

  // Dump JFR before shutdown
  console.log('\n=== JFR dump ===');
  try {
    execFileSync(asprof, ['-d', '3', '-f', `${OUT}/jfr_dump.jfr`, '-o', 'jfr', String(pid)], { timeout: 10000 });
    console.log(`  ${OUT}/jfr_dump.jfr`);
  } catch(e) { console.error(`  jfr: ${e.message}`); }
  
  sv.stdin.write('/stop\n');
  
  setTimeout(() => {
    const logFile = path.join(WORK, 'logs/latest.log');
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf8');
      const tps = [...log.matchAll(/(\d+\.?\d*) tps/g)].slice(-3).map(m => m[1]);
      const mspt = [...log.matchAll(/(\d+\.?\d*) ms per tick/g)].slice(-3).map(m => m[1]);
      if (tps.length) console.log('\nTPS:', tps.join(', '));
      if (mspt.length) console.log('MSPT:', mspt.join(', '));
    }
    console.log(`\nOutput: ${OUT}`);
    cleanup();
  }, 3000);
}
