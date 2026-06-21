/**
 * Nebula Load Test — connects N bot players, moves them, reports metrics.
 * Usage: node loadtest.js [players=10] [host=localhost] [port=25565]
 */
const mineflayer = require('mineflayer');
const fs = require('fs');

const PLAYERS = parseInt(process.argv[2]) || 10;
const HOST = process.argv[3] || 'localhost';
const PORT = parseInt(process.argv[4]) || 25565;

const bots = [];
let startTime = Date.now();
let reportInterval;

// Config
const MOVEMENT_INTERVAL = 5000; // ms between movement bursts

function createBot(id) {
  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: `LoadBot_${id}`,
    version: '1.21.5',
    auth: 'offline',
    skipValidation: true,
  });

  bot.on('login', () => {
    console.log(`[+] Bot ${id} joined`);
  });

  bot.on('move', () => {
    // bots move naturally
  });

  bot.on('error', (err) => {
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      console.error(`[!] Bot ${id} error:`, err.message);
    }
  });

  bot.on('end', (reason) => {
    console.log(`[-] Bot ${id} disconnected: ${reason}`);
  });

  // Random movement every MOVEMENT_INTERVAL ms
  const moveInterval = setInterval(() => {
    if (!bot.entity) return;
    const dir = Math.floor(Math.random() * 4);
    const x = bot.entity.position.x + (dir === 0 ? 5 : dir === 1 ? -5 : 0);
    const z = bot.entity.position.z + (dir === 2 ? 5 : dir === 3 ? -5 : 0);
    bot.look(Math.random() * Math.PI * 2, 0);
    // Use setControlState for continuous movement
    const controls = ['forward', 'back', 'left', 'right'];
    controls.forEach(c => bot.setControlState(c, false));
    bot.setControlState(controls[dir], true);
    setTimeout(() => bot.setControlState(controls[dir], false), 1000);
  }, MOVEMENT_INTERVAL);

  bot.on('end', () => clearInterval(moveInterval));

  return bot;
}

console.log(`[*] Starting ${PLAYERS} bots connecting to ${HOST}:${PORT}...`);

for (let i = 1; i <= PLAYERS; i++) {
  setTimeout(() => {
    const bot = createBot(i);
    bots.push(bot);
  }, i * 200); // stagger connections by 200ms
}

// Wait for all bots, then print summary
setTimeout(() => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[*] Load test running for ${elapsed}s`);
  console.log(`[*] Connected bots: ${bots.filter(b => b.entity).length}/${PLAYERS}`);
  console.log(`[*] Press Ctrl+C to stop`);
}, 10000);
