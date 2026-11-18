import * as THREE from '/vendor/three.module.js';
import {GestureRecognizer, FilesetResolver} from '/vendor/vision_bundle.mjs';
import {GestureLink, saveDesign, listDesigns, loadDesign} from './api.js';

const $ = id => document.getElementById(id), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ---------- settings ----------
const DEF = {speed: .55, steady: .6, reach: 1.2, pinch: .5, color: '#2563eb', rainbow: false, cam: true, verify: true};
let S = {...DEF}; try { Object.assign(S, JSON.parse(localStorage.getItem('gc2')) || {}); } catch (e) {}
if (!S.color || S.color === '#e9e8e4') S.color = '#2563eb';
const keep = () => { try { localStorage.setItem('gc2', JSON.stringify(S)); } catch (e) {} };
const vmax = () => 2 + 12 * S.speed * S.speed;                       // cursor speed limit, cells per second (reduced to 1/4th)
const FMT = {speed: v => Math.round(2 + 12 * v * v) + ' cells/s', steady: v => (+v).toFixed(2), reach: v => (+v).toFixed(2) + '×', pinch: v => Math.round(v * 100) + '%'};
const sync = () => Object.keys(FMT).forEach(k => { $(k).value = S[k]; $(k + 'V').textContent = FMT[k](S[k]); });
Object.keys(FMT).forEach(k => $(k).oninput = e => { S[k] = +e.target.value; $(k + 'V').textContent = FMT[k](S[k]); keep(); });

// ---------- scene ----------
const N = 8, H = 12, MOD = 3;                                         // 16 x 16 plot, 12 levels, 3 m module
const gl = $('gl'), renderer = new THREE.WebGLRenderer({canvas: gl, antialias: true, alpha: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = null;
const cam = new THREE.PerspectiveCamera(36, 1, .1, 300); cam.position.set(7, 17, 31); cam.lookAt(0, 4, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x0b261d, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-14, 26, 12); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80}); sun.shadow.bias = -.0004;
scene.add(sun);
const world = new THREE.Group(); scene.add(world);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({opacity: .2})); ground.receiveShadow = true; ground.position.y = -.008; world.add(ground);
const plateMat = new THREE.MeshStandardMaterial({color: 0x144a38, roughness: .85, metalness: .05, transparent: true, opacity: .92});
const plate = new THREE.Mesh(new THREE.PlaneGeometry(2 * N, 2 * N).rotateX(-Math.PI / 2), plateMat); plate.position.y = -.002; plate.receiveShadow = true; world.add(plate);
const plateBorder = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(2 * N, 2 * N)), new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: .75})); plateBorder.rotation.x = -Math.PI / 2; plateBorder.position.y = .002; world.add(plateBorder);
const gridH = new THREE.GridHelper(2 * N, 2 * N, 0xffffff, 0xffffff); gridH.position.y = .001; gridH.material.transparent = true; gridH.material.opacity = .7; world.add(gridH);
const vol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * N, H, 2 * N)), new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: .28})); vol.position.y = H / 2; world.add(vol);

const boxG = new THREE.BoxGeometry(1, 1, 1), edgeG = new THREE.EdgesGeometry(boxG), edgeM = new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: .65});
const mats = {}; const mat = c => mats[c] || (mats[c] = new THREE.MeshStandardMaterial({color: c, roughness: .9, metalness: 0}));
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, unkey = k => k.split(',').map(Number);
const count = () => $('undo').disabled = !hist.length;
function put(k, color) {
  if (cells.has(k)) return; const [x, y, z] = unkey(k);
  const m = new THREE.Mesh(boxG, mat(color)); m.castShadow = m.receiveShadow = true; m.add(new THREE.LineSegments(edgeG, edgeM));
  m.position.set(x + .5, y + .5, z + .5); world.add(m); cells.set(k, {m, color});
}
function drop(k) { const c = cells.get(k); if (c) { world.remove(c.m); cells.delete(k); } }
const hist = [];
const snap = () => { hist.push([...cells].map(([k, v]) => [k, v.color])); if (hist.length > 60) hist.shift(); count(); };
function restore(s) { [...cells.keys()].forEach(drop); s.forEach(([k, c]) => put(k, c)); }
$('undo').onclick = () => { if (hist.length) { restore(hist.pop()); count(); } };
const clearAll = () => { if (!cells.size) return; snap(); [...cells.keys()].forEach(drop); };
$('clear').onclick = clearAll;
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { $('undo').click(); return; }
  if (e.key === 'r' || e.key === 'R') { recentre(); note('Hand origin recentred'); return; }
  let moved = false;
  if (e.key === 'ArrowUp' || e.key === 'e' || e.key === 'E') { cell[1] = clamp(cell[1] + 1, 0, H - 1); moved = true; }
  else if (e.key === 'ArrowDown' || e.key === 'q' || e.key === 'Q') { cell[1] = clamp(cell[1] - 1, 0, H - 1); moved = true; }
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { cell[0] = clamp(cell[0] - 1, -N, N - 1); moved = true; }
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { cell[0] = clamp(cell[0] + 1, -N, N - 1); moved = true; }
  else if (e.key === 'w' || e.key === 'W') { cell[2] = clamp(cell[2] - 1, -N, N - 1); moved = true; }
  else if (e.key === 's' || e.key === 'S') { cell[2] = clamp(cell[2] + 1, -N, N - 1); moved = true; }
  if (moved) cur = cell.slice();
  else if (e.key === ' ') {
    e.preventDefault();
    const k = key(...cell);
    snap(); put(k, getColor());
    note('Placed block at ' + k);
  }
  if (moved) {
    ghostAt(cell, stable, false, false);
    $('sub').textContent = `x ${cell[0] * MOD}  y ${cell[1] * MOD}  z ${cell[2] * MOD} m (Level ${cell[1] + 1}/${H})`;
  }
});

// Mouse wheel / trackpad scroll changes elevation (Y level)
gl.addEventListener('wheel', e => {
  e.preventDefault();
  const dir = Math.sign(e.deltaY);
  cell[1] = clamp(cell[1] - dir, 0, H - 1);
  ghostAt(cell, stable, false, false);
  $('sub').textContent = `x ${cell[0] * MOD}  y ${cell[1] * MOD}  z ${cell[2] * MOD} m (Level ${cell[1] + 1}/${H})`;
  note(`Level ${cell[1] + 1} (${cell[1] * MOD} m)`);
}, {passive: false});

// cursor, pending volume, delete marker, level plane
const ghost = new THREE.Group(); world.add(ghost);
const gE = new THREE.LineSegments(edgeG, new THREE.LineBasicMaterial({color: 0x2336ff})), gF = new THREE.Mesh(boxG, new THREE.MeshBasicMaterial({color: 0x2336ff, transparent: true, opacity: .16, depthWrite: false}));
ghost.add(gE, gF);
const level = new THREE.Mesh(new THREE.PlaneGeometry(2 * N, 2 * N).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: 0x2336ff, transparent: true, opacity: .05, depthWrite: false})); world.add(level);
const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), new THREE.LineDashedMaterial({color: 0x2336ff, dashSize: .2, gapSize: .15})); stem.computeLineDistances(); world.add(stem);
const prev = new THREE.Group(); world.add(prev);
ghost.visible = level.visible = stem.visible = false;
function setPreview(box, col) {
  prev.clear(); if (!box) return;
  const pCol = col || S.color;
  const [a, b] = box;
  for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
    const m = new THREE.Mesh(boxG, new THREE.MeshBasicMaterial({color: pCol, transparent: true, opacity: .45, depthWrite: false})); m.position.set(x + .5, y + .5, z + .5);
    m.add(new THREE.LineSegments(edgeG, new THREE.LineBasicMaterial({color: pCol}))); prev.add(m);
  }
}
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }; addEventListener('resize', resize); resize();
let yaw = .5, pitch = .1; $('reset').onclick = () => { yaw = .5; pitch = .1; };
let drag = null; gl.onpointerdown = e => drag = [e.clientX, e.clientY]; addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (drag) { yaw += (e.clientX - drag[0]) * .008; pitch = clamp(pitch + (e.clientY - drag[1]) * .005, -.4, .9); drag = [e.clientX, e.clientY]; } });

// ---------- panel ----------
const PAL = [
  ['Cobalt Blue', '#2563eb'],
  ['Coral Red', '#ef4444'],
  ['Emerald Green', '#10b981'],
  ['Sunset Orange', '#f97316'],
  ['Vivid Purple', '#8b5cf6'],
  ['Hot Pink', '#ec4899'],
  ['Electric Cyan', '#06b6d4'],
  ['Gold Yellow', '#eab308'],
  ['Lime', '#84cc16'],
  ['Teal', '#0d9488'],
  ['Rose', '#f43f5e'],
  ['Warm Amber', '#d97706'],
  ['Clay', '#c27a5a'],
  ['Timber', '#c9a36b'],
  ['Concrete', '#e2e8f0'],
  ['Graphite', '#334155']
];

const getColor = () => {
  if (S.rainbow) {
    const vibrant = PAL.slice(0, 11).map(p => p[1]);
    return vibrant[Math.floor(Math.random() * vibrant.length)];
  }
  return S.color;
};

function swatches() {
  const b = $('sw'); b.innerHTML = '';
  PAL.forEach(([n, h]) => {
    const e = document.createElement('button');
    e.style.background = h;
    e.title = n;
    e.setAttribute('aria-label', n);
    e.setAttribute('aria-pressed', S.color === h && !S.rainbow);
    e.onclick = () => {
      S.color = h;
      S.rainbow = false;
      keep();
      swatches();
      updateRainbowBtn();
      note(`Selected color: ${n}`);
    };
    b.appendChild(e);
  });
  const p = document.createElement('input');
  p.type = 'color';
  p.value = S.color;
  p.title = 'Custom colour';
  p.setAttribute('aria-label', 'Custom colour');
  p.oninput = e => {
    S.color = e.target.value;
    S.rainbow = false;
    keep();
    updateRainbowBtn();
  };
  b.appendChild(p);
}

function updateRainbowBtn() {
  const rb = $('rainbow');
  if (rb) {
    rb.style.background = S.rainbow ? 'linear-gradient(90deg, #ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6)' : '';
    rb.style.color = S.rainbow ? '#fff' : '';
    rb.style.fontWeight = S.rainbow ? '600' : 'normal';
  }
}

$('rainbow').onclick = () => {
  S.rainbow = !S.rainbow;
  keep();
  swatches();
  updateRainbowBtn();
  note(S.rainbow ? 'Rainbow Mode: Each block gets a random vibrant color!' : 'Single Color Mode active');
};

$('recolor').onclick = () => {
  snap();
  cells.forEach(c => {
    const cl = getColor();
    c.color = cl;
    c.m.material = mat(cl);
  });
  note('Recoloured all blocks!');
};
const camOn = () => { $('showCam').checked = S.cam; $('cam').style.display = S.cam ? '' : 'none'; }; $('showCam').onchange = e => { S.cam = e.target.checked; keep(); camOn(); };

// ---------- camera view drag-to-resize ----------
(function initCamResize() {
  const camEl = $('cam');
  if (!camEl) return;
  const savedW = localStorage.getItem('gc_cam_w');
  if (savedW && !isNaN(+savedW)) {
    camEl.style.width = Math.min(Math.max(+savedW, 180), window.innerWidth - 48) + 'px';
  }

  let dragMode = null;
  let startX = 0, startY = 0, startW = 0;

  const onPointerDown = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    dragMode = mode;
    startX = e.clientX;
    startY = e.clientY;
    startW = camEl.offsetWidth;
    camEl.classList.add('resizing');
    document.body.style.cursor = mode === 'nw' ? 'nwse-resize' : (mode === 'w' ? 'ew-resize' : 'ns-resize');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = e => {
    if (!dragMode) return;
    const dx = startX - e.clientX;
    const dy = startY - e.clientY;
    let deltaW = 0;
    if (dragMode === 'w') deltaW = dx;
    else if (dragMode === 'n') deltaW = dy * (16 / 9);
    else deltaW = Math.max(dx, dy * (16 / 9));

    const maxW = Math.min(window.innerWidth - 48, 760);
    const newW = Math.round(Math.min(Math.max(startW + deltaW, 180), maxW));
    camEl.style.width = newW + 'px';
  };

  const onPointerUp = () => {
    if (!dragMode) return;
    dragMode = null;
    camEl.classList.remove('resizing');
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    localStorage.setItem('gc_cam_w', camEl.offsetWidth);
  };

  const nw = camEl.querySelector('.cam-handle-nw');
  const w = camEl.querySelector('.cam-handle-w');
  const n = camEl.querySelector('.cam-handle-n');

  if (nw) nw.addEventListener('pointerdown', e => onPointerDown(e, 'nw'));
  if (w) w.addEventListener('pointerdown', e => onPointerDown(e, 'w'));
  if (n) n.addEventListener('pointerdown', e => onPointerDown(e, 'n'));

  if (nw) nw.addEventListener('dblclick', () => {
    const curW = camEl.offsetWidth;
    const targetW = curW > 380 ? 300 : 480;
    camEl.style.width = targetW + 'px';
    localStorage.setItem('gc_cam_w', targetW);
    note(`Camera size: ${targetW}px wide`);
  });
})();
$('export').onclick = () => {
  if (!cells.size) return; let o = '# Gesturecraft massing model, metres\n', n = 0; const F = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  cells.forEach((_, k) => { const [x, y, z] = unkey(k); for (let i = 0; i < 8; i++) o += `v ${(x + (i & 1)) * MOD} ${(y + (i >> 1 & 1)) * MOD} ${(z + (i >> 2 & 1)) * MOD}\n`; F.forEach(f => o += 'f ' + f.map(i => n + i + 1).join(' ') + '\n'); n += 8; });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([o])); a.download = 'gesturecraft-model.obj'; a.click();
};

// ---------- cursor filtering ----------
class OneEuro {                        // adaptive low-pass: steady when slow, quick when fast
  constructor() { this.x = null; this.dx = 0; this.t = 0; }
  a(c, dt) { return 1 / (1 + (1 / (2 * Math.PI * c)) / dt); }
  f(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max((t - this.t) / 1000, 1e-3); this.t = t;
    this.dx += this.a(1.5, dt) * ((v - this.x) / dt - this.dx);
    const minCutoff = 0.5 + 3.0 * (1 - S.steady);
    const beta = 0.08 + 0.12 * S.reach;
    this.x += this.a(minCutoff + beta * Math.abs(this.dx), dt) * (v - this.x); return this.x;
  }
}
let fx = [new OneEuro(), new OneEuro(), new OneEuro()], cur = null, origin = null, lastAnchor = null, lastRaw = null;
function snapAxis(c, p) {
  if (c === null || isNaN(c)) return Math.round(p);
  const thresh = 0.56;
  if (p > c + thresh) return Math.round(p);
  if (p < c - thresh) return Math.round(p);
  return c;
}

// ---------- gesture state ----------
const votes = []; let stable = 'none', pinchOn = false, cell = [0, 0, 0];
let run = null, lostAt = 0, delKey = null, delSince = 0, yoSince = 0, yoDone = false, rotLast = null;
const NAMES = {none: 'Waiting for a hand', open: 'Open palm', pinch: 'Pinch', peace: 'Peace sign', fist: 'Fist', yo: 'Yo sign', idle: 'Hand detected', paused: 'Hand partly out of frame'};
const FING = [[8, 6], [12, 10], [16, 14], [20, 18]];

// backend link: every frame's landmarks go to the server MLP over a WebSocket; its answer is a third check on top of MediaPipe + finger geometry
const link = new GestureLink();
const note = t => { $('note').textContent = t; };
function recentre() { origin = null; }
$('recentre').onclick = recentre;

function classify(res) {
  link.send(res.landmarks[0]);
  const lm = res.landmarks[0], w = res.worldLandmarks[0], cat = res.gestures[0]?.[0]?.categoryName || 'None';
  const ext = FING.map(([t, p]) => d3(w[t], w[0]) > d3(w[p], w[0]) * 1.15);
  const r = d3(w[4], w[8]) / d3(w[5], w[17]), te = .2 + .25 * S.pinch, tr = te + .22;     // thumb–index gap relative to palm width
  const idxReach = d3(w[8], w[0]) / d3(w[6], w[0]);
  pinchOn = pinchOn ? r < tr : r < te;
  let p = 'idle';
  if (pinchOn && cat !== 'Closed_Fist' && idxReach > 1.05) p = 'pinch';                  // fist-with-thumb can never read as a pinch
  else if (cat === 'Victory' && ext[0] && ext[1] && !ext[2] && !ext[3]) p = 'peace';      // ML label and finger geometry must agree
  else if (cat === 'Closed_Fist' && !ext.some(Boolean)) p = 'fist';
  else if (ext[0] && ext[3] && !ext[1] && !ext[2] && cat !== 'Victory' && cat !== 'Closed_Fist') p = 'yo';
  else if (cat === 'Open_Palm' && ext.every(Boolean)) p = 'open';
  const rm = link.fresh();
  $('ml').textContent = rm ? `server model: ${rm.label} ${Math.round(rm.confidence * 100)}%` : 'server model: offline (local checks only)';
  if (S.verify && rm && rm.confidence >= .85 && p !== 'idle' && p !== 'open' && rm.label !== p) p = 'idle';   // server disagrees: do nothing
  return {p, r, lm};
}
function vote(p) { votes.push(p); if (votes.length > 5) votes.shift(); for (const k of new Set(votes)) if (votes.filter(v => v === k).length >= 4) return k; return stable; }

function frame(res, now, dt) {
  const ok = res.landmarks.length && (res.handedness[0][0].score > .7);
  const lm = ok && res.landmarks[0];
  // More forgiving boundary check: never drop tracking unless the core palm genuinely leaves the frame
  const inside = ok && [0, 5, 9, 13, 17].some(i => lm[i].x > .005 && lm[i].x < .995 && lm[i].y > .005 && lm[i].y < .995);
  if (!inside) return lost(now, ok ? 'paused' : 'none');
  
  // Auto-clutch / adapt origin if returning after a brief pause
  const prevLostAt = lostAt;
  lostAt = 0;
  const {p, lm: L} = classify(res); const prevStable = stable; stable = vote(p);
  const asp = $('video').videoWidth / $('video').videoHeight || 1.777;
  // Rigid metacarpal arch (knuckles 9, 5, 13) with wrist: rock-solid palm anchor immune to finger flexing/pinching
  const anchor = {
    x: L[9].x * 0.44 + (L[5].x + L[13].x) * 0.22 + L[0].x * 0.12,
    y: L[9].y * 0.44 + (L[5].y + L[13].y) * 0.22 + L[0].y * 0.12
  };
  const pw = Math.hypot((L[5].x - L[17].x) * asp, L[5].y - L[17].y);
  if (!origin || (prevLostAt > 0 && now - prevLostAt > 1200)) origin = {x: anchor.x, y: anchor.y, pw};

  // Symmetrical horizontal (X) and ergonomic vertical (Y) calibration
  const normSpanX = 0.18;
  const normSpanY = 0.15;
  const normSpanZ = Math.max(origin.pw * 0.65, 0.06);

  const dx = (origin.x - anchor.x) / normSpanX;
  const dy = (origin.y - anchor.y) / normSpanY;
  const dz = (pw - origin.pw) / normSpanZ;

  // Linear precision curve with micro-deadband:
  // 88% linear for intuitive muscle memory; micro-deadband eliminates resting hand tremors
  const deadband = 0.015;
  const curve = v => {
    const av = Math.abs(v);
    if (av < deadband) return 0;
    const s = (av - deadband) / (1 - deadband);
    return Math.sign(v) * (s * 0.88 + Math.pow(s, 2.0) * 0.12) * S.reach;
  };

  const rawX = curve(dx);
  const rawZ = curve(dz);

  // Vertical elevation (Top and Bottom):
  // Resting hand height rests securely on ground (level 0) with a wide, stable resting deadband.
  // Raising hand lifts smoothly and linearly through levels 1, 2, 3... up to H-1.
  let rawY = 0;
  if (dy > 0.04) {
    const lift = Math.min((dy - 0.04) / 0.82, 1.0);
    rawY = (lift * 0.88 + Math.pow(lift, 1.4) * 0.12) * (H - 1);
  }

  // View-aligned translation: aligns screen hand movement to the current 3D view rotation (yaw)
  const cosY = Math.cos(-yaw);
  const sinY = Math.sin(-yaw);
  const tX = rawX * cosY - rawZ * sinY;
  const tZ = rawX * sinY + rawZ * cosY;

  // Symmetrical target grid mapping across all 16x16 blocks
  const tg = [
    clamp(fx[0].f(tX, now), -1, 1) * (N - 0.5),
    clamp(fx[1].f(rawY, now), 0, H - 1),
    clamp(fx[2].f(tZ, now), -1, 1) * (N - 0.5)
  ];
  if (!cur) {
    cur = tg.slice();
  } else {
    // Dynamic exponential tracking: instant tracking during motions, rock-solid damping when hovering
    const d = tg.map((v, i) => v - cur[i]);
    const dist = Math.hypot(...d);
    const alpha = clamp(dt * (14 + 18 * (1 - S.steady) + dist * 10), 0.15, 1.0);
    cur = cur.map((v, i) => v + d[i] * alpha);
  }
  const frozen = stable === 'fist' || stable === 'yo' || stable === 'paused';
  if (!frozen) cell = [snapAxis(cell[0], cur[0]), snapAxis(cell[1], cur[1]), snapAxis(cell[2], cur[2])].map((v, i) => i === 1 ? clamp(v, 0, H - 1) : clamp(v, -N, N - 1));
  const k = key(...cell); let prog = 0, danger = false, sub = `x ${cell[0] * MOD}  y ${cell[1] * MOD}  z ${cell[2] * MOD} m`;

  const nearEdge = [0, 5, 9, 13, 17].some(i => L[i].x < .08 || L[i].x > .92 || L[i].y < .08 || L[i].y > .92);
  if (nearEdge) note('💡 Hand near edge – stay inside camera Comfort Zone or press R to recentre');

  // PINCH: preview while held, commit once on release
  if (stable === 'pinch') {
    if (!run) run = {a: cell.slice(), b: cell.slice(), t0: now, pend: cell.slice(), since: now};
    if (key(...run.pend) !== k) { run.pend = cell.slice(); run.since = now; }
    else if (now - run.since > 90) {
      const lo = run.a.map((v, i) => Math.min(v, run.pend[i])), hi = run.a.map((v, i) => Math.max(v, run.pend[i]));
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) <= 150) run.b = run.pend.slice();
    }
    const lo = run.a.map((v, i) => Math.min(v, run.b[i])), hi = run.a.map((v, i) => Math.max(v, run.b[i]));
    run.box = [lo, hi]; setPreview(run.box, S.color);
    const dims = hi.map((v, i) => v - lo[i] + 1); sub = `${dims[0]} × ${dims[1]} × ${dims[2]} modules · release to place`;
    prog = clamp((now - run.t0) / 150, 0, 1);
  } else if (run) {
    if (prevStable === 'pinch' && (stable === 'open' || stable === 'idle') && now - run.t0 >= 150) {   // only a clean release places
      snap(); const [lo, hi] = run.box;
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) put(key(x, y, z), S.rainbow ? getColor() : S.color);
    }
    run = null; setPreview(null);
  }
  // PEACE: dwell on one block, then remove only that block
  if (stable === 'peace' && cells.has(k)) {
    danger = true; if (delKey !== k) { delKey = k; delSince = now; }
    prog = (now - delSince) / 450;
    if (prog >= 1) { snap(); drop(k); delKey = null; prog = 0; }
  } else delKey = null;
  // FIST: turn the model (relative motion only)
  if (stable === 'fist') { if (rotLast) { yaw -= (anchor.x - rotLast.x) * 5 * S.reach; pitch = clamp(pitch + (anchor.y - rotLast.y) * 3 * S.reach, -.4, .9); } rotLast = anchor; } else rotLast = null;
  // YO: hold to clear
  if (stable === 'yo') { if (!yoSince) { yoSince = now; yoDone = false; } prog = Math.min(1, (now - yoSince) / 900); danger = true; if (prog >= 1 && !yoDone) { clearAll(); yoDone = true; } if (yoDone) prog = 1; }
  else { yoSince = 0; yoDone = false; }

  show(stable, sub, prog, danger, !frozen);
  ghostAt(cell, stable, danger, delKey === k);
  draw(L, stable);
}
function lost(now, why) {
  draw(null);
  if (!lostAt) lostAt = now;
  if (now - lostAt < 1200) return;                       // forgiving 1200ms buffer so temporary occlusions never cancel in-progress pinch
  run = null; setPreview(null); stable = 'none'; votes.length = 0; fx.forEach(f => f.x = null); cur = null; rotLast = null; delKey = null; yoSince = 0; pinchOn = false;
  ghost.visible = level.visible = stem.visible = false; show(why, '–', 0, false, false);
}
function ghostAt(c, p, danger, delTarget) {
  ghost.visible = level.visible = stem.visible = true;
  ghost.position.set(c[0] + .5, c[1] + .5, c[2] + .5); level.position.y = c[1] + .01; stem.position.set(c[0] + .5, c[1], c[2] + .5); stem.scale.set(1, Math.max(c[1], .001), 1);
  const colHex = danger || delTarget ? 0xd6361f : new THREE.Color(S.color).getHex();
  gE.material.color.setHex(colHex); gF.material.color.setHex(colHex); level.material.color.setHex(colHex); stem.material.color.setHex(colHex);
  gF.material.opacity = delTarget ? .35 : .22; ghost.visible = p !== 'fist';
}
const GID = {open: 'g-open', pinch: 'g-pinch', peace: 'g-peace', fist: 'g-fist', yo: 'g-yo'};
function show(p, sub, prog, danger, live) {
  $('pose').textContent = p === 'yo' && prog >= 1 ? 'Cleared' : NAMES[p] || 'Hand detected'; $('sub').textContent = sub;
  $('bar').className = danger ? 'del' : ''; $('bar').firstChild.style.width = prog * 100 + '%';
  Object.entries(GID).forEach(([k, id]) => $(id).classList.toggle('on', k === p));
}
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const ov = $('ov').getContext('2d');
function draw(L, p) {
  const W = ov.canvas.width, H = ov.canvas.height;
  ov.clearRect(0, 0, W, H);
  // Visual Comfort Zone in camera preview:
  const czX = W * 0.22, czY = H * 0.18, czW = W * 0.56, czH = H * 0.64;
  ov.save();
  ov.strokeStyle = 'rgba(16, 185, 129, 0.5)';
  ov.lineWidth = 1.5;
  ov.setLineDash([4, 4]);
  ov.strokeRect(czX, czY, czW, czH);
  ov.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ov.font = '10px "IBM Plex Mono", monospace';
  ov.fillText('COMFORT ZONE (FULL 3D RANGE)', czX + 6, czY + 13);
  ov.restore();
  if (!L) return;
  // Colorful, crisp hand skeleton for colored camera feed
  ov.strokeStyle = p === 'peace' || p === 'yo' ? '#ff3b30' : (p === 'pinch' ? '#22c55e' : '#38bdf8');
  ov.lineWidth = 2.5;
  BONES.forEach(([a, b]) => { ov.beginPath(); ov.moveTo(L[a].x * W, L[a].y * H); ov.lineTo(L[b].x * W, L[b].y * H); ov.stroke(); });
  L.forEach((q, idx) => {
    ov.beginPath();
    ov.arc(q.x * W, q.y * H, (idx === 4 || idx === 8) ? 6 : 4, 0, 7);
    ov.fillStyle = (idx === 4 || idx === 8) ? '#f59e0b' : '#38bdf8';
    ov.fill();
    ov.strokeStyle = '#fff';
    ov.lineWidth = 1;
    ov.stroke();
  });
}

// ---------- saved designs (backend API) ----------
$('save').onclick = async () => {
  try { const r = await saveDesign('Design ' + new Date().toLocaleString(), [...cells].map(([k, v]) => [k, v.color])); note(`Saved design #${r.id}`); }
  catch (e) { note('Save failed: ' + e.message); }
};
$('load').onclick = async () => {
  try {
    const l = await listDesigns(); if (!l.length) return note('No saved designs yet');
    const d = await loadDesign(l[0].id); snap(); [...cells.keys()].forEach(drop); d.blocks.forEach(([k, c]) => put(k, c)); note(`Loaded "${d.name}"`);
  } catch (e) { note('Load failed: ' + e.message); }
};

// ---------- mouse interaction & fallback ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let dragStart = null, hasMoved = false;

gl.addEventListener('pointerdown', e => {
  dragStart = [e.clientX, e.clientY];
  hasMoved = false;
  drag = [e.clientX, e.clientY];
});

gl.addEventListener('pointermove', e => {
  if (dragStart && Math.hypot(e.clientX - dragStart[0], e.clientY - dragStart[1]) > 4) {
    hasMoved = true;
  }
  if (drag) {
    yaw += (e.clientX - drag[0]) * .008;
    pitch = clamp(pitch + (e.clientY - drag[1]) * .005, -.4, .9);
    drag = [e.clientX, e.clientY];
  } else {
    // Raycast hover when not dragging
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(mouse, cam);
    const meshes = [...[...cells.values()].map(c => c.m), plate, ground];
    const hits = ray.intersectObjects(meshes);
    if (hits.length) {
      const hit = hits[0];
      const isExistingBlock = hit.object !== plate && hit.object !== ground;
      let targetCell;
      if (e.shiftKey && isExistingBlock) {
        targetCell = [Math.floor(hit.object.position.x), Math.floor(hit.object.position.y), Math.floor(hit.object.position.z)];
        ghostAt(targetCell, 'peace', true, true);
        $('sub').textContent = `Remove block at ${targetCell[0] * MOD}, ${targetCell[1] * MOD}, ${targetCell[2] * MOD} m (Click to delete)`;
      } else {
        if (hit.object === plate || hit.object === ground) {
          targetCell = [Math.floor(hit.point.x), 0, Math.floor(hit.point.z)];
        } else {
          const pt = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(0.5));
          targetCell = [Math.floor(pt.x), Math.max(0, Math.floor(pt.y)), Math.floor(pt.z)];
        }
        cell = targetCell.map((v, i) => i === 1 ? clamp(v, 0, H - 1) : clamp(v, -N, N - 1));
        ghostAt(cell, 'open', false, false);
        $('sub').textContent = `x ${cell[0] * MOD}  y ${cell[1] * MOD}  z ${cell[2] * MOD} m (Click to place · Shift+Click to delete)`;
      }
    }
  }
});

addEventListener('pointerup', e => {
  if (!hasMoved && dragStart) {
    // Clean click without drag -> place or remove block
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(mouse, cam);
    const meshes = [...[...cells.values()].map(c => c.m), plate, ground];
    const hits = ray.intersectObjects(meshes);
    if (hits.length) {
      const hit = hits[0];
      const isExistingBlock = hit.object !== plate && hit.object !== ground;
      if (e.shiftKey && isExistingBlock) {
        for (const [k, v] of cells.entries()) {
          if (v.m === hit.object) {
            snap(); drop(k);
            note('Block removed');
            break;
          }
        }
      } else {
        let p;
        if (hit.object === plate || hit.object === ground) {
          p = [Math.floor(hit.point.x), 0, Math.floor(hit.point.z)];
        } else {
          const pt = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(0.5));
          p = [Math.floor(pt.x), Math.max(0, Math.floor(pt.y)), Math.floor(pt.z)];
        }
        const k = key(clamp(p[0], -N, N - 1), clamp(p[1], 0, H - 1), clamp(p[2], -N, N - 1));
        snap(); put(k, getColor());
        note('Block placed!');
      }
    }
  }
  drag = null;
  dragStart = null;
});

// Guide buttons click actions (interactive gestures via mouse)
$('g-pinch').style.cursor = 'pointer';
$('g-pinch').title = 'Click to place a block at current cell';
$('g-pinch').onclick = () => {
  const k = key(...cell);
  snap(); put(k, getColor());
  note('Pinch placed block at ' + k);
};

$('g-peace').style.cursor = 'pointer';
$('g-peace').title = 'Click to delete block at current cell';
$('g-peace').onclick = () => {
  const k = key(...cell);
  if (cells.has(k)) {
    snap(); drop(k);
    note('Peace sign deleted block at ' + k);
  } else {
    note('No block at selected cell to delete');
  }
};

$('g-fist').style.cursor = 'pointer';
$('g-fist').title = 'Click to rotate 3D view';
$('g-fist').onclick = () => {
  yaw += 0.8;
  note('Rotated model');
};

$('g-yo').style.cursor = 'pointer';
$('g-yo').title = 'Click to clear all blocks';
$('g-yo').onclick = clearAll;

$('g-open').style.cursor = 'pointer';
$('g-open').title = 'Hover mode';
$('g-open').onclick = () => note('Hovering');

// ---------- start ----------
async function start() {
  sync(); swatches(); updateRainbowBtn(); camOn(); count(); $('verify').checked = S.verify; $('verify').onchange = e => { S.verify = e.target.checked; keep(); };

  // Background initialization of MediaPipe & Camera
  (async () => {
    let vision = null;
    try {
      vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    } catch (e1) {
      console.warn('Local WASM failed, falling back to CDN:', e1);
      vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm').catch(() => null);
    }
    if (!vision) {
      note('Interactive mode active. Click grid to place blocks, drag to orbit.');
      return;
    }

    const opt = (delegate, modelPath) => ({
      baseOptions: {modelAssetPath: modelPath, delegate},
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: .7,
      minHandPresenceConfidence: .7,
      minTrackingConfidence: .7
    });

    const localModel = '/vendor/mediapipe/gesture_recognizer.task';
    const cdnModel = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

    let rec = null;
    try {
      rec = await GestureRecognizer.createFromOptions(vision, opt('GPU', localModel));
    } catch {
      try {
        rec = await GestureRecognizer.createFromOptions(vision, opt('CPU', localModel));
      } catch {
        rec = await GestureRecognizer.createFromOptions(vision, opt('GPU', cdnModel)).catch(() =>
          GestureRecognizer.createFromOptions(vision, opt('CPU', cdnModel)).catch(() => null)
        );
      }
    }

    if (!rec) {
      note('Interactive mode active. Click grid to place blocks, drag to orbit.');
      return;
    }

    // Try starting camera with timeout
    try {
      const v = $('video');
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');

      const camPromise = navigator.mediaDevices.getUserMedia({
        video: {
          width: {ideal: 1280, min: 640},
          height: {ideal: 720, min: 480},
          aspectRatio: {ideal: 1.7777777778},
          facingMode: 'user'
        }
      }).catch(() => navigator.mediaDevices.getUserMedia({video: true}));

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 4000));
      const stream = await Promise.race([camPromise, timeoutPromise]);

      v.srcObject = stream;
      v.play().catch(() => {});

      const resume = () => { if (v.paused) v.play().catch(() => {}); };
      window.addEventListener('click', resume, {passive: true});
      window.addEventListener('touchstart', resume, {passive: true});

      const syncOverlay = () => {
        if (v.videoWidth && ($('ov').width !== v.videoWidth || $('ov').height !== v.videoHeight)) {
          $('ov').width = v.videoWidth;
          $('ov').height = v.videoHeight;
        }
      };
      v.addEventListener('loadedmetadata', syncOverlay);

      let lastT = -1, lastNow = performance.now();
      const tick = () => {
        requestAnimationFrame(tick);
        try {
          if (v.readyState >= 2 && v.videoWidth > 0 && v.currentTime !== lastT) {
            lastT = v.currentTime;
            syncOverlay();
            const now = performance.now();
            const dt = clamp((now - lastNow) / 1000, .001, .1);
            lastNow = now;
            frame(rec.recognizeForVideo(v, now), now, dt);
          }
        } catch {}
      };
      requestAnimationFrame(tick);
      note('Hand tracking active! Show hand to camera.');
    } catch (camErr) {
      console.warn('Webcam not active:', camErr);
      note('Interactive 3D mode: Click to place blocks, drag to rotate view.');
    }
  })().catch(e => console.error('Background init:', e));
}

start();
(function render() { world.rotation.set(pitch, yaw, 0); renderer.render(scene, cam); requestAnimationFrame(render); })();
