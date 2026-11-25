// Dapur Kilat — game memasak 2D canvas.
// Rakit pesanan dari bahan di counter, masak di wajan, sajikan sebelum
// kesabaran pelanggan habis. Keyboard + mouse, offline, tanpa network.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;

// ---- Data: bahan & hidangan asli Indonesia ----
const INGREDIENTS = [
  { id: 'nasi',    name: 'Nasi',    short: 'NS', color: '#fff3d6', edge: '#d9b96a', key: '1' },
  { id: 'mie',     name: 'Mie',     short: 'MI', color: '#ffd76e', edge: '#c98f1b', key: '2' },
  { id: 'telur',   name: 'Telur',   short: 'TL', color: '#ffe9a8', edge: '#d8a419', key: '3' },
  { id: 'ayam',    name: 'Ayam',    short: 'AY', color: '#e8a06a', edge: '#a85f22', key: '4' },
  { id: 'sayur',   name: 'Sayur',   short: 'SY', color: '#7cc46a', edge: '#3e7d2e', key: '5' },
  { id: 'sambal',  name: 'Sambal',  short: 'SM', color: '#e8492f', edge: '#8f1d0c', key: '6' },
  { id: 'kuah',    name: 'Kuah',    short: 'KH', color: '#c98d4b', edge: '#7a4d16', key: '7' },
];
const ING = Object.fromEntries(INGREDIENTS.map((g) => [g.id, g]));

const DISHES = [
  { name: 'Nasi Goreng',  need: ['nasi', 'telur', 'ayam', 'sambal'], price: 120, color: '#e2703a' },
  { name: 'Mie Goreng',   need: ['mie', 'telur', 'sayur', 'sambal'], price: 110, color: '#d99a26' },
  { name: 'Sate Ayam',    need: ['ayam', 'sambal', 'sayur'],         price: 100, color: '#b4552d' },
  { name: 'Gado-Gado',    need: ['sayur', 'telur', 'sambal', 'kuah'],price: 130, color: '#5d8a3c' },
  { name: 'Bakso',        need: ['mie', 'ayam', 'sayur', 'kuah'],    price: 140, color: '#a9713f' },
  { name: 'Ayam Geprek',  need: ['ayam', 'sambal', 'nasi'],          price: 110, color: '#c0392b' },
];

// ---- State ----
const SHIFT_LEN = 150; // detik per shift
const state = {
  screen: 'menu', // menu | play | over
  t: 0,
  timeLeft: SHIFT_LEN,
  score: 0,
  coins: 0,
  served: 0,
  lost: 0,
  combo: 0,
  bestCombo: 0,
  level: 1,
  orders: [],       // {dish, patience, max, id}
  plate: [],        // ingredient ids di piring rakitan
  cooking: 0,       // 0 = tidak masak, >0 = progress 0..1
  cooked: false,    // piring sudah matang, siap saji
  readyPlate: null, // hidangan matang yang menunggu disajikan (untuk cover)
  spawnIn: 2.5,
  nextId: 1,
  flash: '',        // pesan singkat: "Mantap! +180" / "Salah resep!"
  flashT: 0,
  shake: 0,
  muted: false,
};
let hover = { x: -1, y: -1 };

// ---- Suara kecil via WebAudio (tanpa file) ----
let audioCtx = null;
function beep(freq, dur = 0.09, type = 'sine', vol = 0.12) {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio opsional */ }
}
const sfx = {
  pick: () => beep(520, 0.07, 'triangle', 0.10),
  cook: () => beep(300, 0.12, 'sawtooth', 0.05),
  done: () => { beep(660, 0.09); setTimeout(() => beep(880, 0.12), 90); },
  serve: () => { beep(523, 0.08); setTimeout(() => beep(659, 0.08), 80); setTimeout(() => beep(784, 0.14), 160); },
  bad: () => beep(160, 0.18, 'square', 0.08),
  lost: () => beep(220, 0.25, 'sawtooth', 0.07),
};

// ---- Util ----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pickDish = () => DISHES[Math.floor(Math.random() * DISHES.length)];
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join(','), sb = [...b].sort().join(',');
  return sa === sb;
}
function spawnOrder() {
  const dish = pickDish();
  const max = Math.max(28, 48 - state.level * 2);
  state.orders.push({ dish, patience: max, max, id: state.nextId++ });
}
function newShift() {
  state.screen = 'play';
  state.t = 0; state.timeLeft = SHIFT_LEN;
  state.score = 0; state.coins = 0; state.served = 0; state.lost = 0;
  state.combo = 0; state.bestCombo = 0; state.level = 1;
  state.orders = []; state.plate = []; state.cooking = 0; state.cooked = false;
  state.readyPlate = null; state.spawnIn = 1.2; state.nextId = 1;
  state.flash = ''; state.flashT = 0;
  spawnOrder(); spawnOrder();
}

// ---- Aksi pemain ----
function addIngredient(id) {
  if (state.screen !== 'play' || state.cooking > 0) return;
  if (state.plate.length >= 5) { state.flash = 'Piring penuh! Masak dulu.'; state.flashT = 1.4; return; }
  state.plate.push(id);
  state.cooked = false;
  sfx.pick();
}
function startCooking() {
  if (state.screen !== 'play' || state.cooking > 0) return;
  if (state.plate.length < 2) { state.flash = 'Tambah bahan dulu (min. 2)!'; state.flashT = 1.4; sfx.bad(); return; }
  state.cooking = 0.0001;
  sfx.cook();
}
function servePlate() {
  if (state.screen !== 'play' || state.cooking > 0) return;
  if (!state.cooked) { state.flash = 'Belum matang! Tekan MASAK dulu.'; state.flashT = 1.4; sfx.bad(); return; }
  if (state.plate.length === 0) return;
  const match = state.orders.find((o) => sameSet(o.dish.need, state.plate));
  if (match) {
    const patienceBonus = Math.round(60 * (match.patience / match.max));
    const comboBonus = state.combo * 25;
    const gain = match.dish.price + patienceBonus + comboBonus;
    state.score += gain;
    state.coins += gain;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.served += 1;
    state.flash = `Mantap! ${match.dish.name} +${gain}` + (state.combo > 1 ? `  (kombo x${state.combo})` : '');
    state.flashT = 1.8;
    state.orders = state.orders.filter((o) => o !== match);
    state.plate = [];
    state.cooked = false;
    state.readyPlate = null;
    if (state.served % 5 === 0) { state.level += 1; state.flash += '  — NAIK LEVEL!'; }
    sfx.serve();
  } else {
    state.score = Math.max(0, state.score - 50);
    state.combo = 0;
    state.flash = 'Salah resep! −50 (cek tiket pesanan)';
    state.flashT = 1.8;
    state.shake = 0.35;
    sfx.bad();
  }
}
function trashPlate() {
  if (state.screen !== 'play' || state.cooking > 0) return;
  if (state.plate.length === 0) return;
  state.plate = [];
  state.cooked = false;
  state.readyPlate = null;
  state.flash = 'Piring dibuang.';
  state.flashT = 1.0;
  sfx.bad();
}

// ---- Hit areas (dipakai klik + hover) ----
function ingredientRect(i) {
  const bw = 84, gap = 10, x0 = 330, y = 606;
  return { x: x0 + i * (bw + gap), y, w: bw, h: 96 };
}
function cookRect() { return { x: 1010, y: 470, w: 240, h: 64 }; }
function serveRect() { return { x: 1010, y: 544, w: 240, h: 64 }; }
function trashRect() { return { x: 1010, y: 618, w: 240, h: 44 }; }
function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  hover.x = (e.clientX - r.left) * (W / r.width);
  hover.y = (e.clientY - r.top) * (H / r.height);
});
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  if (state.screen === 'menu') { newShift(); return; }
  if (state.screen === 'over') {
    if (x >= 490 && x <= 790 && y >= 520 && y <= 584) newShift();
    return;
  }
  for (let i = 0; i < INGREDIENTS.length; i++) {
    if (inRect(ingredientRect(i), x, y)) { addIngredient(INGREDIENTS[i].id); return; }
  }
  if (inRect(cookRect(), x, y)) { startCooking(); return; }
  if (inRect(serveRect(), x, y)) { servePlate(); return; }
  if (inRect(trashRect(), x, y)) { trashPlate(); return; }
});
window.addEventListener('keydown', (e) => {
  if (state.screen === 'menu' && (e.key === 'Enter' || e.key === ' ')) { newShift(); return; }
  if (state.screen === 'over' && (e.key === 'r' || e.key === 'R' || e.key === 'Enter')) { newShift(); return; }
  if (state.screen !== 'play') return;
  const ing = INGREDIENTS.find((g) => g.key === e.key);
  if (ing) { addIngredient(ing.id); return; }
  if (e.key === ' ') { e.preventDefault(); startCooking(); }
  if (e.key === 'Enter') servePlate();
  if (e.key === 'Delete' || e.key === 'Backspace') trashPlate();
  if (e.key === 'm' || e.key === 'M') state.muted = !state.muted;
});

// ---- Update ----
let last = performance.now();
function update(dt) {
  state.t += dt;
  if (state.flashT > 0) state.flashT -= dt;
  if (state.shake > 0) state.shake -= dt;
  if (state.screen !== 'play') return;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) { state.timeLeft = 0; state.screen = 'over'; sfx.lost(); return; }
  // masak
  if (state.cooking > 0) {
    state.cooking += dt / 3; // 3 detik di wajan
    if (state.cooking >= 1) {
      state.cooking = 0;
      state.cooked = true;
      state.readyPlate = [...state.plate];
      state.flash = 'Matang! Siap disajikan.';
      state.flashT = 1.4;
      sfx.done();
    }
  }
  // pesanan baru
  state.spawnIn -= dt;
  if (state.spawnIn <= 0 && state.orders.length < 3) {
    spawnOrder();
    state.spawnIn = Math.max(4.5, 9 - state.level);
  }
  // kesabaran pelanggan
  for (const o of state.orders) o.patience -= dt * (1 + (state.level - 1) * 0.06);
  const expired = state.orders.filter((o) => o.patience <= 0);
  if (expired.length) {
    state.orders = state.orders.filter((o) => o.patience > 0);
    state.lost += expired.length;
    state.combo = 0;
    state.flash = 'Pelanggan pergi! Pesanan hangus.';
    state.flashT = 1.8;
    sfx.lost();
  }
}

// ---- Gambar: helper ----
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function panel(x, y, w, h, fill, stroke) {
  rr(x, y, w, h, 14);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function text(str, x, y, size, color, weight = 'bold', align = 'center') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Segoe UI", Verdana, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
function drawIngredientIcon(id, x, y, r) {
  const g = ING[id];
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g.color; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = g.edge; ctx.stroke();
  text(g.short, x, y + 1, Math.round(r * 0.72), '#5a3a1a', 'bold');
}

// ---- Gambar: dapur ----
function drawKitchen() {
  // dinding + lantai
  ctx.fillStyle = '#f2c98f'; ctx.fillRect(0, 0, W, 470);
  ctx.fillStyle = '#e8b877'; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = '#c98d4b';
  for (let x = 0; x < W; x += 64) ctx.fillRect(x, 470, 64, 4);
  ctx.fillStyle = '#b5773a'; ctx.fillRect(0, 470, W, 250);
  ctx.fillStyle = '#a86a33';
  for (let x = -40; x < W; x += 96) {
    ctx.beginPath(); ctx.moveTo(x, 720); ctx.lineTo(x + 48, 470); ctx.lineTo(x + 96, 470); ctx.lineTo(x + 48, 720); ctx.closePath(); ctx.fill();
  }
  // ubin dinding
  ctx.strokeStyle = 'rgba(120,70,20,.18)'; ctx.lineWidth = 2;
  for (let y = 24; y < 460; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = 0; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 470); ctx.stroke(); }
  // jendela + lampu gantung
  panel(1020, 24, 220, 120, '#bfe3f0', '#7a4d16');
  ctx.fillStyle = '#ffd76e'; ctx.beginPath(); ctx.arc(1090, 84, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7ec850'; ctx.fillRect(1020, 118, 220, 26);
  for (const lx of [420, 700, 940]) {
    ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, 46); ctx.stroke();
    ctx.fillStyle = '#e8492f';
    ctx.beginPath(); ctx.moveTo(lx - 26, 52); ctx.lineTo(lx + 26, 52); ctx.lineTo(lx, 76); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(lx, 62, 9, 0, Math.PI * 2); ctx.fill();
  }
  // poster menu di dinding
  panel(330, 24, 300, 56, '#fff8e6', '#7a4d16');
  text('MENU HARI INI  •  6 HIDANGAN', 480, 52, 19, '#8a4b12');
  // meja kerja tengah (counter kayu)
  panel(310, 440, 660, 46, '#8a5a2e', '#5a3a1a');
  panel(310, 440, 660, 12, '#a9713f', '#5a3a1a');
}

function drawTopBar() {
  panel(0, 0, W, 64, '#3a2417');
  text('🍳 DAPUR KILAT', 16, 32, 30, '#ffd76e', 'bold', 'left');
  text('SHIFT', 330, 20, 13, '#d8c9a8');
  text(fmtTime(state.timeLeft), 330, 46, 24, state.timeLeft < 30 ? '#ff6b4a' : '#ffffff');
  text('SKOR', 470, 20, 13, '#d8c9a8');
  text(String(state.score), 470, 46, 24, '#ffffff');
  text('KOINS', 600, 20, 13, '#d8c9a8');
  text('🪙 ' + state.coins, 600, 46, 22, '#ffd76e');
  text('KOMBO', 740, 20, 13, '#d8c9a8');
  text(state.combo > 1 ? 'x' + state.combo : '—', 740, 46, 24, state.combo > 1 ? '#ff9d2e' : '#ffffff');
  text('LEVEL ' + state.level, 880, 32, 20, '#ffffff');
  text('Disajikan ' + state.served + '  •  Hangus ' + state.lost, 1000, 32, 16, '#d8c9a8', 'bold', 'left');
}

// ---- Gambar: papan pesanan ----
function drawOrders() {
  panel(16, 80, 280, 380, '#fff8e6', '#7a4d16');
  text('PAPAN PESANAN', 156, 104, 19, '#8a4b12');
  ctx.fillStyle = '#e8b877'; ctx.fillRect(32, 120, 248, 3);
  if (state.orders.length === 0) {
    text('Belum ada pesanan…', 156, 240, 16, '#a08a6a');
    text('Pelanggan segera datang!', 156, 268, 14, '#a08a6a', 'normal');
    return;
  }
  state.orders.forEach((o, i) => {
    const y = 140 + i * 100;
    const frac = clamp(o.patience / o.max, 0, 1);
    const urgent = frac < 0.35;
    panel(32, y, 248, 88, urgent ? '#ffe3d6' : '#ffffff', urgent ? '#c0392b' : '#d9b96a');
    text('#' + o.id + '  ' + o.dish.name, 44, y + 18, 17, o.dish.color, 'bold', 'left');
    o.dish.need.forEach((id, j) => drawIngredientIcon(id, 62 + j * 44, y + 52, 17));
    text('Rp' + o.dish.price, 268, y + 18, 15, '#5a3a1a', 'bold', 'right');
    // bar kesabaran
    ctx.fillStyle = '#e8dcc0'; rr(44, y + 72, 224, 10, 5); ctx.fill();
    ctx.fillStyle = frac > 0.5 ? '#5da83c' : frac > 0.25 ? '#e8a13a' : '#e8492f';
    rr(44, y + 72, 224 * frac, 10, 5); ctx.fill();
  });
  // pelanggan menunggu (ikon kepala)
  text('👨‍🍳 3 pelanggan menunggu di depan', 156, 452, 14, '#8a4b12', 'bold');
}

// ---- Gambar: piring rakitan + wajan ----
function drawAssembly() {
  const shakeX = state.shake > 0 ? rand(-6, 6) : 0;
  // area perakitan
  panel(330 + shakeX, 150, 420, 270, 'rgba(255,248,230,.92)', '#7a4d16');
  text('PIRING RAKITAN', 540 + shakeX, 174, 18, '#8a4b12');
  // piring
  ctx.beginPath(); ctx.ellipse(540 + shakeX, 300, 130, 62, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#c9a86a'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(540 + shakeX, 300, 104, 46, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f3e2b8'; ctx.fill();
  if (state.plate.length === 0) {
    text('Klik bahan di bawah', 540 + shakeX, 300, 17, '#a08a6a', 'normal');
  } else {
    // Ikon bahan tersusun rapi di atas piring (grid 3+2), tidak saling tindih.
    const spots = [[500, 286], [560, 286], [620, 286], [530, 322], [590, 322]];
    state.plate.forEach((id, i) => {
      const [px, py] = spots[i] || [540 + shakeX, 300];
      drawIngredientIcon(id, px + shakeX, py, 24);
    });
    const names = state.plate.map((id) => ING[id].name).join(' + ');
    text(names, 540 + shakeX, 392, 15, '#5a3a1a', 'bold');
  }
  // status masak
  if (state.cooking > 0) {
    text('🔥 SEDANG DIMASAK…', 540 + shakeX, 210, 16, '#c0392b');
    ctx.fillStyle = '#e8dcc0'; rr(400 + shakeX, 224, 280, 12, 6); ctx.fill();
    ctx.fillStyle = '#e8492f'; rr(400 + shakeX, 224, 280 * clamp(state.cooking, 0, 1), 12, 6); ctx.fill();
  } else if (state.cooked) {
    text('✅ MATANG — SIAP DISAJIKAN!', 540 + shakeX, 210, 16, '#3e7d2e');
  }
  // wajan (stasiun masak)
  panel(790, 150, 190, 270, 'rgba(255,248,230,.92)', '#7a4d16');
  text('WAJAN', 885, 174, 18, '#8a4b12');
  ctx.beginPath(); ctx.ellipse(885, 300, 78, 34, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3a3a3a'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#1c1c1c'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(885, 296, 62, 24, 0, 0, Math.PI * 2);
  ctx.fillStyle = state.cooking > 0 ? '#e8492f' : '#5a5a5a'; ctx.fill();
  if (state.cooking > 0) {
    for (let f = 0; f < 3; f++) {
      const fx = 855 + f * 30 + Math.sin(state.t * 9 + f * 2) * 4;
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath(); ctx.moveTo(fx, 268); ctx.lineTo(fx - 8, 288); ctx.lineTo(fx + 8, 288); ctx.closePath(); ctx.fill();
    }
  }
  text(state.cooking > 0 ? 'Memasak…' : 'Wajan panas', 885, 360, 15, '#5a3a1a', 'bold');
  text('3 detik', 885, 384, 13, '#a08a6a', 'normal');
  // piring siap saji (pass)
  panel(1010, 150, 240, 270, 'rgba(255,248,230,.92)', '#7a4d16');
  text('MEJA SAJI', 1130, 174, 18, '#8a4b12');
  ctx.beginPath(); ctx.ellipse(1130, 300, 84, 42, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = state.cooked ? '#3e7d2e' : '#c9a86a'; ctx.stroke();
  if (state.readyPlate && state.readyPlate.length) {
    state.readyPlate.forEach((id, i) => {
      drawIngredientIcon(id, 1090 + (i % 3) * 40, 288 + Math.floor(i / 3) * 34, 16);
    });
    text('SIAP SAJI!', 1130, 380, 17, '#3e7d2e');
  } else {
    text('— kosong —', 1130, 300, 16, '#a08a6a', 'normal');
    text('Hidangan matang', 1130, 372, 13, '#a08a6a', 'normal');
    text('muncul di sini', 1130, 392, 13, '#a08a6a', 'normal');
  }
}

// ---- Gambar: counter bahan + tombol aksi ----
function drawCounter() {
  panel(310, 596, 690, 112, '#6b4423', '#4a2c12');
  text('COUNTER BAHAN — klik untuk menambah ke piring', 640, 614, 14, '#ffd76e', 'bold');
  INGREDIENTS.forEach((g, i) => {
    const r = ingredientRect(i);
    const hov = inRect(r, hover.x, hover.y) && state.screen === 'play';
    panel(r.x, r.y + 16, r.w, r.h - 16, hov ? '#ffe9a8' : '#fff8e6', hov ? '#e8492f' : '#7a4d16');
    drawIngredientIcon(g.id, r.x + r.w / 2, r.y + 48, 20);
    text(g.name, r.x + r.w / 2, r.y + 76, 14, '#5a3a1a');
    text('[' + g.key + ']', r.x + r.w / 2, r.y + 92, 11, '#a08a6a', 'normal');
  });
  // tombol aksi kanan
  const cook = cookRect(), serve = serveRect(), trash = trashRect();
  const cookHov = inRect(cook, hover.x, hover.y);
  panel(cook.x, cook.y, cook.w, cook.h, state.cooking > 0 ? '#c9a86a' : cookHov ? '#ff8a5c' : '#e8492f', '#8f1d0c');
  text(state.cooking > 0 ? 'MEMASAK… ' + Math.round(clamp(state.cooking, 0, 1) * 100) + '%' : '🔥  MASAK  [Spasi]', cook.x + cook.w / 2, cook.y + cook.h / 2, 19, '#ffffff');
  const serveHov = inRect(serve, hover.x, hover.y);
  panel(serve.x, serve.y, serve.w, serve.h, state.cooked ? (serveHov ? '#6fbf4a' : '#3e7d2e') : '#8a9a7a', '#2c5a1e');
  text('🍽️  SAJIKAN  [Enter]', serve.x + serve.w / 2, serve.y + serve.h / 2, 19, '#ffffff');
  const trashHov = inRect(trash, hover.x, hover.y);
  panel(trash.x, trash.y, trash.w, trash.h, trashHov ? '#d8b96a' : '#c9a86a', '#7a4d16');
  text('🗑  Buang piring  [Del]', trash.x + trash.w / 2, trash.y + trash.h / 2, 14, '#5a3a1a');
}

// ---- Gambar: menu & game over ----
function drawMenu() {
  ctx.fillStyle = 'rgba(43,26,18,.45)'; ctx.fillRect(0, 0, W, H);
  panel(290, 130, 700, 430, '#fff8e6', '#7a4d16');
  text('🍳', 640, 200, 64, '#e8492f');
  text('DAPUR KILAT', 640, 268, 56, '#c0392b');
  text('Game Memasak — Warung Indonesia', 640, 312, 20, '#8a4b12', 'bold');
  text('Pesanan masuk di papan kiri. Klik bahan di counter,', 640, 352, 17, '#5a3a1a', 'normal');
  text('masak di wajan, sajikan sebelum pelanggan kehabisan sabar!', 640, 378, 17, '#5a3a1a', 'normal');
  text('6 hidangan  •  kombo beruntun  •  shift 2½ menit', 640, 414, 16, '#3e7d2e', 'bold');
  panel(490, 448, 300, 56, '#e8492f', '#8f1d0c');
  text('▶  MULAI MASAK', 640, 476, 22, '#ffffff');
  text('Klik di mana saja atau tekan Enter', 640, 528, 14, '#a08a6a', 'normal');
}
function drawGameOver() {
  ctx.fillStyle = 'rgba(43,26,18,.55)'; ctx.fillRect(0, 0, W, H);
  panel(340, 110, 600, 460, '#fff8e6', '#7a4d16');
  text('⏰  SHIFT SELESAI!', 640, 168, 40, '#c0392b');
  text('Skor akhir', 640, 226, 18, '#8a4b12');
  text(String(state.score), 640, 272, 54, '#5a3a1a');
  text('Hidangan disajikan: ' + state.served + '    •    Hangus: ' + state.lost, 640, 330, 18, '#5a3a1a', 'bold');
  text('Kombo terbaik: x' + Math.max(1, state.bestCombo) + '    •    Level: ' + state.level, 640, 360, 18, '#5a3a1a', 'bold');
  const verdict = state.served >= 15 ? '🏆 Koki Bintang Lima! Warungmu legendaris.'
    : state.served >= 8 ? '⭐ Koki Andal! Pelanggan pulang senang.'
    : state.served >= 4 ? '👍 Lumayan! Latihan lagi besok.'
    : '💪 Jangan menyerah — besok pasti lebih cepat!';
  text(verdict, 640, 402, 17, '#3e7d2e', 'bold');
  panel(490, 520, 300, 64, '#e8492f', '#8f1d0c');
  text('↻  MASAK LAGI  [R]', 640, 552, 22, '#ffffff');
}
function drawFlash() {
  if (state.flashT <= 0 || !state.flash) return;
  const a = clamp(state.flashT, 0, 1);
  ctx.globalAlpha = a;
  panel(380, 84, 520, 40, 'rgba(58,36,23,.92)');
  text(state.flash, 640, 104, 17, '#ffd76e');
  ctx.globalAlpha = 1;
}

// ---- Render utama + loop ----
function render() {
  drawKitchen();
  drawTopBar();
  drawOrders();
  drawAssembly();
  drawCounter();
  drawFlash();
  if (state.screen === 'menu') drawMenu();
  if (state.screen === 'over') drawGameOver();
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---- Staging untuk screenshot (?shot=cover|play|serve|end) ----
function stageShot(kind) {
  newShift();
  state.screen = 'play';
  if (kind === 'cover') {
    state.score = 1250; state.coins = 1250; state.combo = 3; state.bestCombo = 4;
    state.level = 2; state.served = 7; state.timeLeft = 107;
    state.orders = [
      { dish: DISHES[0], patience: 14, max: 44, id: 11 },
      { dish: DISHES[1], patience: 30, max: 44, id: 12 },
      { dish: DISHES[4], patience: 40, max: 44, id: 13 },
    ];
    state.plate = ['nasi', 'telur', 'ayam'];
    state.cooking = 0.65;
    state.readyPlate = ['mie', 'telur', 'sayur', 'sambal'];
    state.flash = 'Mantap! Mie Goreng +180  (kombo x3)';
    state.flashT = 99;
  } else if (kind === 'play') {
    state.timeLeft = 138;
    state.orders = [{ dish: DISHES[3], patience: 38, max: 44, id: 21 }];
    state.plate = ['sayur', 'telur'];
    state.flash = '';
  } else if (kind === 'serve') {
    state.score = 860; state.coins = 860; state.combo = 2; state.served = 5;
    state.timeLeft = 92;
    state.orders = [{ dish: DISHES[0], patience: 22, max: 44, id: 31 }];
    state.plate = ['nasi', 'telur', 'ayam', 'sambal'];
    state.cooked = true;
    state.readyPlate = ['nasi', 'telur', 'ayam', 'sambal'];
    state.flash = 'Matang! Siap disajikan.';
    state.flashT = 99;
  } else if (kind === 'end') {
    state.score = 2140; state.served = 14; state.lost = 2; state.bestCombo = 5; state.level = 3;
    state.timeLeft = 0; state.screen = 'over';
  }
}

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot) {
  stageShot(shot);
  window.dapurKilat = { state, stageShot };
  render();
} else {
  window.dapurKilat = { state, stageShot };
  requestAnimationFrame(frame);
}
