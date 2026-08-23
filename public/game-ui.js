import { WORLD, createGame, jump, restartGame, setQaState, startGame, stepGame, strideFrame, togglePause } from './game-core.js';

const shell = document.querySelector('#game');
const canvas = document.querySelector('#game-canvas');
const context = canvas.getContext('2d', { alpha: false });
const score = document.querySelector('#game-score');
const best = document.querySelector('#game-best');
const lasso = document.querySelector('#game-lasso');
const startButton = document.querySelector('#game-start');
const restartButton = document.querySelector('#game-restart');
const pauseButton = document.querySelector('#game-pause');
const soundButton = document.querySelector('#game-sound');
const overPanel = document.querySelector('#game-over-panel');
const finalDistance = document.querySelector('#game-final-distance');
const finalScore = document.querySelector('#game-final-score');
const live = document.querySelector('#game-live');
const yoinkLabel = document.querySelector('#game-yoink');
const params = new URLSearchParams(location.search);
const seed = Number(params.get('gameSeed')) || crypto.getRandomValues(new Uint32Array(1))[0];
const qaState = params.get('gameQa');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let state;
let assets;
let lastFrame = performance.now();
let bestScore = readNumber('logo-yoink-best');
let soundEnabled = readBoolean('logo-yoink-sound', true);
let audioContext;
let automaticallyPaused = false;
let ropeEffect = null;
let deathEffect = null;
let startEffect = null;
let transitionScenery = [];
let particles = [];
let hitTimer;
let yoinkTimer;
startButton.disabled = true;

const RIDER_DRAW_X = 127;
const RIDER_DRAW_SIZE = 296;
const RIDER_DRAW_Y_OFFSET = 118;
const YOINK_DURATION = 820;

function readNumber(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

function readBoolean(key, fallback) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch { return fallback; }
}

function persist(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* The game remains fully playable without storage. */ }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${source}`));
    image.src = source;
  });
}

async function loadAssets() {
  const manifest = await fetch('/assets/game/logos/manifest.json').then(response => response.json());
  const logos = manifest.filter(item => item.enabled);
  const loaded = await Promise.all([
    loadImage('/assets/game/desert-desktop.webp'),
    loadImage('/assets/game/desert-mobile.webp'),
    loadImage('/assets/game/lasso.png?v=2'),
    ...Array.from({ length: 3 }, (_, index) => loadImage(`/assets/game/cactus-${index}.png`)),
    ...Array.from({ length: 6 }, (_, index) => loadImage(`/assets/game/rider-${index}.png?v=2`)),
    ...Array.from({ length: 4 }, (_, index) => loadImage(`/assets/game/rider-lasso-${index}.png?v=4`)),
    ...logos.map(item => loadImage(item.file)),
  ]);
  return {
    desktop: loaded[0],
    mobile: loaded[1],
    powerup: loaded[2],
    cacti: loaded.slice(3, 6),
    riders: loaded.slice(6, 12),
    lassoRiders: loaded.slice(12, 16),
    logoImages: loaded.slice(16),
    logos,
  };
}

function reset(carryScene = []) {
  state = restartGame(state ?? createGame({ seed, logoCount: assets.logos.length }), { seed, logoCount: assets.logos.length });
  state.bestScore = bestScore;
  overPanel.hidden = true;
  shell.classList.remove('is-over');
  live.textContent = '';
  ropeEffect = null;
  deathEffect = null;
  startEffect = null;
  transitionScenery = carryScene;
  particles = [];
  shell.classList.remove('is-dying', 'is-hit', 'is-starting');
  updateHud();
}

function begin() {
  if (!state || !assets) return;
  if (state.status === 'gameover') {
    const carryScene = state.entities
      .filter(entity => ['cactus', 'logo', 'lasso'].includes(entity.type))
      .map(entity => ({ ...entity }));
    reset(carryScene);
  }
  const entering = state.status === 'idle';
  if (entering) {
    startEffect = {
      elapsed: 0,
      duration: reducedMotion ? 1 : 1450,
      fromX: canvas.clientWidth < 650 ? 372 : 732,
    };
  }
  startGame(state);
  ensureAudio();
  shell.classList.add('is-running', 'has-started');
  shell.classList.toggle('is-starting', entering);
  shell.classList.remove('is-paused', 'is-over');
  canvas.focus({ preventScroll: true });
  updateHud();
}

function requestJump() {
  if (!state) return;
  if (state.status === 'idle' || state.status === 'gameover') return;
  if (jump(state)) tone('jump');
}

function pause() {
  if (!state) return;
  togglePause(state);
  shell.classList.toggle('is-paused', state.status === 'paused');
  pauseButton.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
}

function ensureAudio() {
  if (!soundEnabled || audioContext) return;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioCtor) audioContext = new AudioCtor();
}

function tone(type) {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioContext) return;
  if (audioContext.state === 'suspended') audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  const settings = {
    jump: [220, 430, .11, 'square'], collect: [620, 940, .12, 'square'],
    lasso: [330, 780, .22, 'sawtooth'], hit: [150, 70, .25, 'square'],
    gameover: [220, 80, .5, 'sawtooth'],
  }[type] ?? [300, 500, .1, 'square'];
  oscillator.type = settings[3];
  oscillator.frequency.setValueAtTime(settings[0], now);
  oscillator.frequency.exponentialRampToValueAtTime(settings[1], now + settings[2]);
  gain.gain.setValueAtTime(.055, now);
  gain.gain.exponentialRampToValueAtTime(.001, now + settings[2]);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + settings[2]);
}

function showYoink() {
  yoinkLabel.textContent = 'YOINK!';
  yoinkLabel.classList.remove('is-active');
  shell.classList.remove('is-yoinking');
  void yoinkLabel.offsetWidth;
  yoinkLabel.classList.add('is-active');
  shell.classList.add('is-yoinking');
  clearTimeout(yoinkTimer);
  yoinkTimer = setTimeout(() => shell.classList.remove('is-yoinking'), YOINK_DURATION);
}

function burst(x, y, color = '#ffd91c', count = 10) {
  if (reducedMotion) return;
  for (let index = 0; index < count; index++) {
    const angle = Math.PI * 2 * index / count;
    particles.push({ x, y, vx: Math.cos(angle) * (55 + index * 4), vy: Math.sin(angle) * (55 + index * 3), life: 520, color });
  }
}

function handleEvents() {
  for (const event of state.events) {
    if (event.type === 'collect') {
      tone('collect'); burst(event.x, event.y, '#fff4a8'); live.textContent = `Logo collected. Score ${state.score}.`;
    } else if (event.type === 'lasso') {
      tone('lasso'); burst(event.x, event.y, '#ffd91c', 14); live.textContent = 'Lasso ready. The next three logos will be yoinked.';
    } else if (event.type === 'yoink') {
      tone('lasso'); showYoink(); burst(event.x, event.y, '#ffd91c', 14);
      ropeEffect = { x: event.x, y: event.y, logoIndex: event.logoIndex, life: YOINK_DURATION, duration: YOINK_DURATION };
      live.textContent = `Logo yoinked. ${event.remaining} lasso charges remain.`;
    } else if (event.type === 'hit') {
      tone('hit'); live.textContent = 'Cactus hit. Game over.';
      burst(WORLD.riderX + 175, WORLD.groundY - 65, '#fff4a8', 18);
      shell.classList.add('is-hit'); clearTimeout(hitTimer); hitTimer = setTimeout(() => shell.classList.remove('is-hit'), 520);
    } else if (event.type === 'gameover') {
      tone('gameover'); startDeathTransition();
    }
  }
}

function startDeathTransition() {
  if (deathEffect || shell.classList.contains('is-over')) return;
  if (reducedMotion) {
    finishRun();
    return;
  }
  deathEffect = { elapsed: 0, duration: 1720, panelAt: 1040, panelShown: false };
  shell.classList.add('is-dying');
  pauseButton.disabled = true;
}

function advanceDeath(delta) {
  if (!deathEffect || deathEffect.frozen || deathEffect.elapsed >= deathEffect.duration) return;
  deathEffect.elapsed = Math.min(deathEffect.duration, deathEffect.elapsed + Math.min(50, Math.max(0, delta)));
  if (!deathEffect.panelShown && deathEffect.elapsed >= deathEffect.panelAt) {
    deathEffect.panelShown = true;
    finishRun();
  }
}

function advanceStart(delta) {
  if (!startEffect || startEffect.frozen) return;
  startEffect.elapsed = Math.min(startEffect.duration, startEffect.elapsed + Math.min(50, Math.max(0, delta)));
  if (startEffect.elapsed >= startEffect.duration) {
    startEffect = null;
    transitionScenery = [];
    shell.classList.remove('is-starting');
  }
}

function entryProgress() {
  if (!startEffect) return 1;
  const progress = Math.min(1, startEffect.elapsed / startEffect.duration);
  return progress < .5
    ? 4 * progress ** 3
    : 1 - (-2 * progress + 2) ** 3 / 2;
}

function currentRiderX() {
  if (!startEffect) return RIDER_DRAW_X;
  const progress = entryProgress();
  return startEffect.fromX + (RIDER_DRAW_X - startEffect.fromX) * progress;
}

function entryRawProgress() {
  if (!startEffect) return 1;
  return Math.min(1, startEffect.elapsed / startEffect.duration);
}

function finishRun() {
  if (state.score > bestScore) { bestScore = state.score; persist('logo-yoink-best', bestScore); }
  finalDistance.textContent = Math.floor(state.distance);
  finalScore.textContent = state.score.toLocaleString();
  overPanel.hidden = false;
  shell.classList.remove('is-running', 'is-paused');
  shell.classList.add('is-over');
  pauseButton.disabled = false;
  live.textContent = `Game over. Final score ${state.score}.`;
  updateHud();
}

function updateHud() {
  const padded = value => String(Math.max(0, Math.floor(value))).padStart(5, '0');
  score.textContent = padded(state?.score ?? 0);
  best.textContent = padded(Math.max(bestScore, state?.score ?? 0));
  lasso.textContent = `×${state?.lassoCharges ?? 0}`;
  soundButton.textContent = soundEnabled ? 'Sound on' : 'Sound off';
  soundButton.setAttribute('aria-pressed', String(soundEnabled));
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawLogo(entity) {
  const item = assets.logos[entity.logoIndex % assets.logos.length];
  const image = assets.logoImages[entity.logoIndex % assets.logoImages.length];
  const pulse = 1 + Math.sin((state.timeMs + entity.id * 250) / 180) * .045;
  const size = entity.width * pulse;
  const x = entity.x - (size - entity.width) / 2;
  const y = entity.y - (size - entity.height) / 2;
  context.save();
  context.shadowColor = 'rgba(255,220,35,.9)'; context.shadowBlur = 18;
  roundedRect(context, x, y, size, size, 14); context.fillStyle = item.brandColor; context.fill();
  context.shadowBlur = 0; context.lineWidth = 5; context.strokeStyle = '#6c2c0c'; context.stroke();
  roundedRect(context, x + 8, y + 8, size - 16, size - 16, 9); context.fillStyle = '#fff9df'; context.fill();
  context.drawImage(image, x + 17, y + 17, size - 34, size - 34);
  context.restore();
}

function drawEntity(entity, offsetX = 0, opacity = 1) {
  const target = offsetX ? { ...entity, x: entity.x + offsetX } : entity;
  context.save();
  context.globalAlpha = opacity;
  if (target.type === 'cactus') context.drawImage(assets.cacti[target.artVariant ?? 0], target.x - 10, target.y, target.width + 20, target.height);
  else if (target.type === 'lasso') context.drawImage(assets.powerup, target.x - 8, target.y - 8, target.width + 16, target.height + 16);
  else drawLogo(target);
  context.restore();
}

function drawYoinkEffect(effect) {
  const progress = effect.frozenProgress ?? Math.min(1, Math.max(0, 1 - effect.life / effect.duration));
  const eased = progress < .5
    ? 4 * progress ** 3
    : 1 - (-2 * progress + 2) ** 3 / 2;
  const handX = RIDER_DRAW_X + 190;
  const handY = state.rider.y + 43;
  const logoSize = 76 * (1 - eased * .22);
  const logoX = effect.x + (handX - effect.x) * eased;
  const logoY = effect.y + (handY - effect.y) * eased - Math.sin(eased * Math.PI) * 118;

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const [stroke, width] of [['#55250d', 14], ['#ffb719', 8], ['#ffe36b', 3]]) {
    context.strokeStyle = stroke;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(handX, handY);
    context.quadraticCurveTo((handX + logoX) / 2, logoY - 105 * Math.sin(progress * Math.PI), logoX + logoSize / 2, logoY + logoSize / 2);
    context.stroke();
  }

  context.translate(logoX + logoSize / 2, logoY + logoSize / 2);
  context.rotate(-.18 + progress * .42);
  context.strokeStyle = '#55250d'; context.lineWidth = 12;
  context.beginPath(); context.ellipse(0, 0, logoSize * .68, logoSize * .56, 0, 0, Math.PI * 2); context.stroke();
  context.strokeStyle = '#ffbd19'; context.lineWidth = 7; context.stroke();
  context.restore();

  for (let index = 1; index <= 5; index++) {
    const trail = Math.max(0, eased - index * .055);
    const x = effect.x + (handX - effect.x) * trail + logoSize / 2;
    const y = effect.y + (handY - effect.y) * trail - Math.sin(trail * Math.PI) * 118 + logoSize / 2;
    context.globalAlpha = (6 - index) / 10;
    context.fillStyle = index % 2 ? '#fff4a8' : '#ffd91c';
    context.fillRect(Math.round(x), Math.round(y), 8 - index, 8 - index);
  }
  context.globalAlpha = 1;
  drawLogo({ id: 9000 + effect.logoIndex, type: 'logo', logoIndex: effect.logoIndex, x: logoX, y: logoY, width: logoSize, height: logoSize });
}

function drawScrollingGround(viewWidth, bottomWorld) {
  const grassY = WORLD.groundY - 13;
  const tileWidth = WORLD.width;
  const tileHeight = 141;
  const seamOverlap = 2;
  const firstTile = Math.floor(state.travelPx / tileWidth);
  const offset = -(state.travelPx % tileWidth);

  context.fillStyle = '#41221d';
  context.fillRect(0, grassY, viewWidth, bottomWorld - grassY + 2);

  for (let x = offset, tile = firstTile; x < viewWidth; x += tileWidth, tile++) {
    context.save();
    if (tile % 2) {
      context.translate(Math.round(x + tileWidth + seamOverlap / 2), 0);
      context.scale(-1, 1);
      context.drawImage(assets.desktop, 0, 892, 1920, 188, 0, grassY, tileWidth + seamOverlap, tileHeight);
    } else {
      context.drawImage(assets.desktop, 0, 892, 1920, 188, Math.round(x - seamOverlap / 2), grassY, tileWidth + seamOverlap, tileHeight);
    }
    context.restore();
  }
}

function drawRunningDust() {
  if (state.status !== 'running' || !state.rider.onGround || reducedMotion) return;
  const cycle = (state.timeMs / 6) % 120;
  const hoofX = currentRiderX() + 80;
  for (let index = 0; index < 4; index++) {
    const phase = (cycle + index * 29) % 120;
    const size = Math.max(3, 10 - phase / 17);
    context.globalAlpha = Math.max(0, 1 - phase / 120);
    context.fillStyle = index % 2 ? '#f6bd55' : '#d97a2a';
    context.fillRect(hoofX - phase * .65, WORLD.groundY - 13 - Math.sin(phase / 18) * 18, size, size);
  }
  context.globalAlpha = 1;
}

function drawDeathEffect() {
  const progress = Math.min(1, deathEffect.elapsed / deathEffect.duration);
  const image = assets.riders[5];
  const baseY = state.rider.y - RIDER_DRAW_Y_OFFSET;
  let x = RIDER_DRAW_X;
  let y = baseY;
  let rotation = 0;
  let scaleX = 1;
  let scaleY = 1;

  if (progress < .16) {
    const skid = progress / .16;
    x += skid * 34;
    y += Math.sin(skid * Math.PI) * 10;
    rotation = -.08 * skid;
    scaleX = 1 + .11 * skid;
    scaleY = 1 - .13 * skid;
  } else if (progress < .7) {
    const flight = (progress - .16) / .54;
    x += 34 + flight * 126;
    y -= Math.sin(flight * Math.PI) * 148;
    rotation = -.08 + flight * .56;
  } else {
    const settle = (progress - .7) / .3;
    x += 160 + settle * 22;
    y -= Math.sin(settle * Math.PI) * 30;
    rotation = .48 * (1 - settle) + .08;
    scaleX = 1 + Math.sin(settle * Math.PI) * .12;
    scaleY = 1 - Math.sin(settle * Math.PI) * .16;
  }

  context.save();
  context.translate(x + RIDER_DRAW_SIZE / 2, y + RIDER_DRAW_SIZE);
  context.rotate(rotation);
  context.scale(scaleX, scaleY);
  context.drawImage(image, -RIDER_DRAW_SIZE / 2, -RIDER_DRAW_SIZE, RIDER_DRAW_SIZE, RIDER_DRAW_SIZE);
  context.restore();

  if (progress > .12 && progress < .82) {
    const orbit = (progress - .12) * Math.PI * 5;
    for (let index = 0; index < 4; index++) {
      const angle = orbit + index * Math.PI / 2;
      const starX = x + 157 + Math.cos(angle) * (68 + index * 5);
      const starY = y + 73 + Math.sin(angle) * 30;
      const size = index % 2 ? 7 : 10;
      context.fillStyle = index % 2 ? '#fff4a8' : '#ffd91c';
      context.fillRect(Math.round(starX - size / 2), Math.round(starY - 2), size, 4);
      context.fillRect(Math.round(starX - 2), Math.round(starY - size / 2), 4, size);
    }
  }
}

function draw() {
  const background = canvas.clientWidth < 650 ? assets.mobile : assets.desktop;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(background, 0, 0, canvas.width, canvas.height);

  const viewWidth = canvas.clientWidth < 650 ? 720 : WORLD.width;
  const worldScale = canvas.width / viewWidth;
  const visibleHeight = canvas.height / worldScale;
  const worldOffsetY = Math.max(0, visibleHeight * .84 - WORLD.groundY);
  context.setTransform(worldScale, 0, 0, worldScale, 0, worldOffsetY * worldScale);

  const bottomWorld = visibleHeight - worldOffsetY;
  drawScrollingGround(viewWidth, bottomWorld);

  if (startEffect && transitionScenery.length) {
    const opacity = Math.max(0, 1 - entryRawProgress());
    const travel = -state.travelPx;
    for (const entity of transitionScenery) drawEntity(entity, travel, opacity);
  }
  for (const entity of state.entities) drawEntity(entity);
  if (ropeEffect) drawYoinkEffect(ropeEffect);

  drawRunningDust();

  const invulnerableBlink = state.invulnerableMs > 0 && Math.floor(state.invulnerableMs / 90) % 2 === 0;
  if (deathEffect) {
    drawDeathEffect();
  } else if (!invulnerableBlink) {
    const riderIndex = state.rider.onGround ? strideFrame(state, 3) : state.rider.vy < 0 ? 3 : 4;
    const bob = state.rider.onGround && state.status === 'running' ? Math.sin(state.travelPx / 16) * 2 : 0;
    const riderX = startEffect
      ? currentRiderX()
      : ['running', 'paused'].includes(state.status) ? RIDER_DRAW_X : canvas.clientWidth < 650 ? 372 : 732;
    let riderImage = assets.riders[state.status === 'gameover' ? 5 : riderIndex];
    if (state.status !== 'gameover' && (state.lassoCharges > 0 || ropeEffect)) {
      const armedCycle = [0, 1, 3, 1];
      const lassoIndex = ropeEffect ? (ropeEffect.life > ropeEffect.duration * .34 ? 2 : 3) : armedCycle[strideFrame(state, armedCycle.length)];
      riderImage = assets.lassoRiders[lassoIndex];
    }
    const entryArc = startEffect ? Math.sin(entryProgress() * Math.PI) * -12 : 0;
    const entryLean = startEffect ? Math.sin(entryProgress() * Math.PI) * -.045 : 0;
    if (entryLean) {
      context.save();
      context.translate(riderX + RIDER_DRAW_SIZE / 2, state.rider.y - RIDER_DRAW_Y_OFFSET + bob + entryArc + RIDER_DRAW_SIZE);
      context.rotate(entryLean);
      context.drawImage(riderImage, -RIDER_DRAW_SIZE / 2, -RIDER_DRAW_SIZE, RIDER_DRAW_SIZE, RIDER_DRAW_SIZE);
      context.restore();
    } else {
      context.drawImage(riderImage, riderX, state.rider.y - RIDER_DRAW_Y_OFFSET + bob + entryArc, RIDER_DRAW_SIZE, RIDER_DRAW_SIZE);
    }
  }

  const dt = 16;
  particles = particles.filter(particle => {
    particle.life -= dt; particle.x += particle.vx * dt / 1000; particle.y += particle.vy * dt / 1000; particle.vy += 160 * dt / 1000;
    if (particle.life <= 0) return false;
    context.fillStyle = particle.color; context.fillRect(Math.round(particle.x), Math.round(particle.y), 7, 7); return true;
  });
  if (ropeEffect && ropeEffect.frozenProgress === undefined) { ropeEffect.life -= dt; if (ropeEffect.life <= 0) ropeEffect = null; }
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function resize() {
  const rect = shell.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}

function frame(now) {
  const delta = now - lastFrame;
  lastFrame = now;
  if (state.status === 'running') {
    stepGame(state, delta);
    handleEvents();
    updateHud();
  }
  advanceStart(delta);
  advanceDeath(delta);
  draw();
  requestAnimationFrame(frame);
}

startButton.addEventListener('click', begin);
restartButton.addEventListener('click', begin);
pauseButton.addEventListener('click', pause);
soundButton.addEventListener('click', () => { soundEnabled = !soundEnabled; persist('logo-yoink-sound', soundEnabled); if (soundEnabled) ensureAudio(); updateHud(); });
shell.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('a, button')) return;
  if (state?.status === 'idle' || state?.status === 'gameover') begin();
  else requestJump();
});
window.addEventListener('keydown', event => {
  if (!state) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) {
    event.preventDefault();
    if (state.status === 'idle' || state.status === 'gameover') begin();
    else requestJump();
  }
  else if (['KeyP', 'Escape'].includes(event.code) && ['running', 'paused'].includes(state.status)) { event.preventDefault(); pause(); }
});
document.addEventListener('visibilitychange', () => {
  if (!state) return;
  if (document.hidden && state.status === 'running') { automaticallyPaused = true; pause(); }
  else if (!document.hidden && automaticallyPaused && state.status === 'paused') { automaticallyPaused = false; pause(); }
});
new IntersectionObserver(([entry]) => {
  if (!state) return;
  if (!entry.isIntersecting && state.status === 'running') { automaticallyPaused = true; pause(); }
  else if (entry.isIntersecting && automaticallyPaused && state.status === 'paused') { automaticallyPaused = false; pause(); }
}, { threshold: .05 }).observe(shell);
new ResizeObserver(resize).observe(shell);

try {
  assets = await loadAssets();
  state = createGame({ seed, logoCount: assets.logos.length });
  state.bestScore = bestScore;
  setQaState(state, qaState);
  if (qaState && qaState !== 'start') shell.classList.add('is-running', 'has-started');
  if (qaState === 'yoink') {
    ropeEffect = { x: 760, y: WORLD.groundY - 215, logoIndex: 7, life: YOINK_DURATION / 2, duration: YOINK_DURATION, frozenProgress: .5 };
    yoinkLabel.classList.add('qa-visible');
  }
  if (qaState === 'death') {
    deathEffect = { elapsed: 650, duration: 1720, panelAt: 1040, panelShown: false, frozen: true };
    shell.classList.add('is-dying');
  }
  if (qaState === 'start-motion') {
    startGame(state);
    state.status = 'paused';
    startEffect = { elapsed: 725, duration: 1450, fromX: canvas.clientWidth < 650 ? 372 : 732, frozen: true };
    transitionScenery = [
      { id: 9101, type: 'cactus', x: 900, y: WORLD.groundY - 96, width: 58, height: 96, artVariant: 1 },
      { id: 9102, type: 'logo', x: 1160, y: WORLD.groundY - 220, width: 76, height: 76, logoIndex: 3 },
    ];
    shell.classList.add('is-running', 'has-started', 'is-starting');
  }
  if (qaState === 'damage') shell.classList.add('qa-damage');
  if (qaState === 'gameover') finishRun();
  shell.classList.toggle('reduce-motion', reducedMotion);
  startButton.disabled = false;
  updateHud(); resize(); requestAnimationFrame(frame);
} catch (error) {
  live.textContent = 'The game artwork could not be loaded. The logo finder below is still available.';
  console.error(error);
}
