#!/usr/bin/env node
/**
 * CPU-focused profiler under heavy entity load.
 * Uses -e cpu with all-user flag to work around perf restrictions.
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const HOME = process.env.HOME;

const CPU_S = parseInt(process.argv[2]) || 30;
const ENTITY_COUNT = parseInt(process.argv[3]) || 3000;
const JAVA = path.join(HOME, 'tools/jdk-25.0.3+9/bin/java');
const JAR = path.join(HOME, 'Documenti/_Spyral/nebula-spigot/leaf-server/build/libs/leaf-bundler-1.21.11.local-SNAPSHOT.jar');
const ASPROF = path.join(HOME, 'tools/async-profiler-3.0-linux-x64/bin/asprof');
const WORK = `/tmp/nscpu-${Date.now()}`;
const OUT = '/tmp/nscpu';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'eula.txt'), 'eula=true\n');
fs.writeFileSync(path.join(WORK, 'server.properties'),
  'online-mode=false\nserver-port=25565\nsimulation-distance=8\nview-distance=8\n');

console.log(`[setup] ${WORK}`);

const sv = spawn(JAVA, ['-Xms1G', '-Xmx2G', '-jar', JAR, '--nogui'], {
  cwd: WORK, stdio: ['pipe', 'pipe', 'pipe']
});
let ready = false;
sv.stdout.on('data', d => {
  const t = d.toString();
  const lines = t.split('\n').filter(l => l);
  for (const l of lines.slice(0, 2)) process.stdout.write(l.substring(0, 100) + '\n');
  if (t.includes('Done (') && !ready) { ready = true;
    console.log('\n[server] Ready');
    setTimeout(spawnEntities, 3000);
  }
});
sv.stderr.on('data', d => {});
setTimeout(() => { if (!ready) { console.error('[FAIL]'); cleanup(); process.exit(1); } }, 40000);

function cleanup() { try { sv.kill('SIGTERM'); } catch(e) {} setTimeout(() => { try { sv.kill('SIGKILL'); } catch(e) {} process.exit(0); }, 3000); }

function spawnEntities() {
  console.log(`[load] ${ENTITY_COUNT} chickens...`);
  const side = Math.ceil(Math.sqrt(ENTITY_COUNT));
  let spawned = 0;
  function batch() {
    if (spawned >= ENTITY_COUNT) {
      console.log('[load] done');
      setTimeout(profile, 3000);
      return;
    }
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
  console.log(`[profile] PID ${pid}, ${CPU_S}s`);

  // CPU with cstack=no (skip native), all-user to minimize restrictions
  console.log(`\n=== CPU flat (${CPU_S}s) ===`);
  try {
    execFileSync(ASPROF, ['-d', String(CPU_S), '-f', `${OUT}/cpu_flat.txt`, '-o', 'flat',
      '-e', 'cpu', '-i', '5ms', '--cstack', 'no', String(pid)], { timeout: CPU_S * 1000 + 10000 });
    const d = fs.readFileSync(`${OUT}/cpu_flat.txt`, 'utf8').split('\n').filter(l => l.trim()).slice(0, 80).join('\n');
    console.log(d);
  } catch(e) { console.error(`  ${e.message}`); }

  // CPU flamegraph
  console.log('\n=== CPU flamegraph ===');
  try {
    execFileSync(ASPROF, ['-d', '15', '-f', `${OUT}/cpu.html`, '-o', 'flamegraph',
      '-e', 'cpu', '-i', '5ms', '--cstack', 'no', String(pid)], { timeout: 25000 });
    console.log(`  ${OUT}/cpu.html`);
  } catch(e) { console.error(`  ${e.message}`); }

  // Alloc profile (doesn't need perf)
  console.log('\n=== Alloc flat ===');
  try {
    execFileSync(ASPROF, ['-d', '10', '-f', `${OUT}/alloc_flat.txt`, '-o', 'flat', '-e', 'alloc', String(pid)], { timeout: 20000 });
    const d = fs.readFileSync(`${OUT}/alloc_flat.txt`, 'utf8').split('\n').filter(l => l.trim()).slice(0, 50).join('\n');
    console.log(d);
  } catch(e) { console.error(`  ${e.message}`); }

  sv.stdin.write('/tps\n');
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
