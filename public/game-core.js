export const WORLD = Object.freeze({ width: 1440, height: 720, groundY: 620, riderX: 185, riderWidth: 224, riderHeight: 166, tickMs: 20 });
export const LOGO_POINTS = 250;
export const CACTUS_SIZES = Object.freeze([
  Object.freeze({ variant: 'small', width: 44, height: 74 }),
  Object.freeze({ variant: 'medium', width: 58, height: 96 }),
  Object.freeze({ variant: 'tall', width: 70, height: 118 }),
]);
export const CACTUS_TYPES = Object.freeze([
  Object.freeze({ id: 'classic', widthScale: 1, heightScale: 1 }),
  Object.freeze({ id: 'forked', widthScale: .78, heightScale: 1.05 }),
  Object.freeze({ id: 'prickly-pear', widthScale: 1.45, heightScale: .72 }),
]);

const GRAVITY = 1850;
const JUMP_VELOCITY = -980;
const INVULNERABLE_MS = 1250;

function normalizeSeed(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (parsed >>> 0) || 1 : 0x59f15e;
}

function random(state) {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let value = state.rngState;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

function between(state, min, max) {
  return min + random(state) * (max - min);
}

export function strideFrame(state, frameCount, stridePx = 52) {
  return Math.floor(Math.max(0, state.travelPx) / stridePx) % Math.max(1, frameCount);
}

export function createGame({ seed = 0x59f15e, logoCount = 12 } = {}) {
  const normalizedSeed = normalizeSeed(seed);
  return {
    seed: normalizedSeed,
    rngState: normalizedSeed,
    logoCount: Math.max(1, logoCount),
    status: 'idle',
    previousStatus: 'idle',
    accumulatorMs: 0,
    timeMs: 0,
    speed: 360,
    travelPx: 0,
    distance: 0,
    score: 0,
    bestScore: 0,
    hearts: 1,
    lassoCharges: 0,
    invulnerableMs: 0,
    rider: { y: WORLD.groundY - WORLD.riderHeight, vy: 0, onGround: true },
    entities: [],
    effects: [],
    nextEntityId: 1,
    obstacleInMs: 1750,
    obstacleClusterFollowup: false,
    lastObstaclePattern: 'opening',
    logoInMs: 900,
    lassoInMs: between({ rngState: normalizedSeed }, 2000, 4000),
    collected: 0,
    events: [],
  };
}

export function startGame(state) {
  if (state.status === 'gameover') return state;
  state.status = 'running';
  state.previousStatus = 'running';
  state.events.push({ type: 'start' });
  return state;
}

export function restartGame(state, options = {}) {
  return createGame({ seed: options.seed ?? state.seed, logoCount: options.logoCount ?? state.logoCount });
}

export function togglePause(state) {
  if (state.status === 'running') {
    state.status = 'paused';
    state.previousStatus = 'running';
    state.events.push({ type: 'pause' });
  } else if (state.status === 'paused') {
    state.status = 'running';
    state.events.push({ type: 'resume' });
  }
  return state;
}

export function jump(state) {
  if (state.status !== 'running' || !state.rider.onGround) return false;
  state.rider.vy = JUMP_VELOCITY;
  state.rider.onGround = false;
  state.events.push({ type: 'jump' });
  return true;
}

export function addEntity(state, entity) {
  const defaults = entity.type === 'cactus'
    ? { y: WORLD.groundY - 102, width: 62, height: 102 }
    : entity.type === 'lasso'
      ? { y: WORLD.groundY - 210, width: 104, height: 104 }
      : { y: WORLD.groundY - 210, width: 76, height: 76 };
  const created = { id: state.nextEntityId++, hit: false, logoIndex: 0, ...defaults, ...entity };
  state.entities.push(created);
  return created;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function riderRect(state) {
  return {
    x: WORLD.riderX + 36,
    y: state.rider.y + 30,
    width: WORLD.riderWidth - 76,
    height: WORLD.riderHeight - 45,
  };
}

function entityRect(entity) {
  const insetX = entity.type === 'cactus' ? 10 : 6;
  const insetY = entity.type === 'cactus' ? 8 : 6;
  return { x: entity.x + insetX, y: entity.y + insetY, width: entity.width - insetX * 2, height: entity.height - insetY * 2 };
}

function collectLogo(state, entity, automatic = false) {
  state.logoPoints = (state.logoPoints ?? 0) + LOGO_POINTS;
  state.collected += 1;
  if (automatic) state.lassoCharges = Math.max(0, state.lassoCharges - 1);
  state.events.push({ type: automatic ? 'yoink' : 'collect', x: entity.x, y: entity.y, logoIndex: entity.logoIndex, remaining: state.lassoCharges });
  entity.remove = true;
}

function collectLasso(state, entity) {
  state.lassoCharges = 3;
  state.events.push({ type: 'lasso', x: entity.x, y: entity.y });
  entity.remove = true;
  state.lassoInMs = between(state, 10000, 15000);
}

function hitCactus(state, entity) {
  if (state.invulnerableMs > 0 || entity.hit) return;
  entity.hit = true;
  state.hearts -= 1;
  state.invulnerableMs = INVULNERABLE_MS;
  state.events.push({ type: 'hit', hearts: state.hearts });
  if (state.hearts <= 0) {
    state.status = 'gameover';
    state.events.push({ type: 'gameover', score: state.score });
  }
}

function spawnObstacle(state) {
  const completesCluster = state.obstacleClusterFollowup;
  const size = CACTUS_SIZES[Math.floor(random(state) * CACTUS_SIZES.length)];
  const artVariant = Math.floor(random(state) * CACTUS_TYPES.length);
  const cactusType = CACTUS_TYPES[artVariant];
  const width = Math.round(size.width * cactusType.widthScale);
  const height = Math.round(size.height * cactusType.heightScale);
  addEntity(state, {
    type: 'cactus',
    x: WORLD.width + 70,
    y: WORLD.groundY - height,
    width,
    height,
    variant: size.variant,
    artVariant,
    encounterPart: completesCluster ? 'cluster-end' : 'single',
  });

  const minimumRecoveryMs = ((state.speed * 1.32 + 170) / state.speed) * 1000;
  if (completesCluster) {
    state.obstacleClusterFollowup = false;
    state.lastObstaclePattern = 'cluster-recovery';
    state.obstacleInMs = minimumRecoveryMs + between(state, 1200, 2200);
    return;
  }

  const patternRoll = random(state);
  if (patternRoll < 0.22) {
    // Render doubles as one compact cactus clump. Accounting for the complete
    // rider/cactus collision widths, wider separation would outlast the jump arc.
    state.obstacleClusterFollowup = true;
    state.lastObstaclePattern = 'cluster';
    state.obstacleInMs = between(state, 90, 140);
  } else if (patternRoll < 0.48) {
    state.lastObstaclePattern = 'short';
    state.obstacleInMs = minimumRecoveryMs + between(state, 80, 260);
  } else if (patternRoll < 0.8) {
    state.lastObstaclePattern = 'medium';
    state.obstacleInMs = minimumRecoveryMs + between(state, 450, 950);
  } else {
    state.lastObstaclePattern = 'long';
    state.obstacleInMs = minimumRecoveryMs + between(state, 1200, 2300);
  }
}

function spawnLogo(state) {
  const crowded = state.entities.some(entity => entity.type === 'cactus' && entity.x > WORLD.width - 260);
  if (crowded) {
    state.logoInMs = 420;
    return;
  }
  const heights = [150, 205, 258];
  const height = heights[Math.floor(random(state) * heights.length)];
  addEntity(state, { type: 'logo', x: WORLD.width + 70, y: WORLD.groundY - height, logoIndex: Math.floor(random(state) * state.logoCount) });
  state.logoInMs = between(state, 1150, 2050);
}

function spawnLasso(state) {
  addEntity(state, { type: 'lasso', x: WORLD.width + 90 });
  state.lassoInMs = Number.POSITIVE_INFINITY;
}

function tick(state, dtMs) {
  state.timeMs += dtMs;
  state.speed = Math.min(740, 360 + state.timeMs * 0.0063);
  const travelPx = state.speed * dtMs / 1000;
  state.travelPx += travelPx;
  state.distance += travelPx / 12;
  state.score = Math.floor(state.distance) + (state.logoPoints ?? 0);
  state.invulnerableMs = Math.max(0, state.invulnerableMs - dtMs);

  if (!state.rider.onGround) {
    state.rider.vy += GRAVITY * dtMs / 1000;
    state.rider.y += state.rider.vy * dtMs / 1000;
    const ground = WORLD.groundY - WORLD.riderHeight;
    if (state.rider.y >= ground) {
      state.rider.y = ground;
      state.rider.vy = 0;
      state.rider.onGround = true;
      state.events.push({ type: 'land' });
    }
  }

  state.obstacleInMs -= dtMs;
  state.logoInMs -= dtMs;
  state.lassoInMs -= dtMs;
  if (state.obstacleInMs <= 0) spawnObstacle(state);
  if (state.logoInMs <= 0) spawnLogo(state);
  if (state.lassoInMs <= 0) spawnLasso(state);

  const rider = riderRect(state);
  for (const entity of state.entities) {
    entity.x -= travelPx;
    if (entity.type === 'logo' && state.lassoCharges > 0 && entity.x <= WORLD.riderX + 490 && entity.x > WORLD.riderX + 80) {
      collectLogo(state, entity, true);
      continue;
    }
    if (!overlaps(rider, entityRect(entity))) continue;
    if (entity.type === 'logo') collectLogo(state, entity, false);
    else if (entity.type === 'lasso') collectLasso(state, entity);
    else if (entity.type === 'cactus') hitCactus(state, entity);
  }
  for (const entity of state.entities) {
    if (entity.type === 'lasso' && !entity.remove && entity.x + entity.width <= -100 && !Number.isFinite(state.lassoInMs)) {
      state.lassoInMs = between(state, 6000, 10000);
    }
  }
  state.entities = state.entities.filter(entity => !entity.remove && entity.x + entity.width > -100);
}

export function stepGame(state, deltaMs) {
  if (state.status !== 'running') {
    state.events = [];
    return state;
  }
  state.events = [];
  state.accumulatorMs += Math.min(250, Math.max(0, deltaMs));
  while (state.accumulatorMs >= WORLD.tickMs && state.status === 'running') {
    tick(state, WORLD.tickMs);
    state.accumulatorMs -= WORLD.tickMs;
  }
  return state;
}

export function setQaState(state, qaState) {
  if (!qaState || qaState === 'start') return state;
  startGame(state);
  if (qaState === 'lasso') {
    state.lassoCharges = 3;
    state.obstacleInMs = 999999;
    state.logoInMs = 999999;
    state.lassoInMs = 999999;
    state.status = 'paused';
  } else if (qaState === 'yoink') {
    state.lassoCharges = 2;
    state.obstacleInMs = 999999;
    state.logoInMs = 999999;
    state.lassoInMs = 999999;
    state.status = 'paused';
  } else if (qaState === 'cacti') {
    state.obstacleInMs = 999999;
    state.logoInMs = 999999;
    state.lassoInMs = 999999;
    CACTUS_SIZES.forEach((size, index) => {
      const cactusType = CACTUS_TYPES[index];
      const width = Math.round(size.width * cactusType.widthScale);
      const height = Math.round(size.height * cactusType.heightScale);
      addEntity(state, { type: 'cactus', x: 650 + index * 230, y: WORLD.groundY - height, width, height, variant: size.variant, artVariant: index });
    });
    state.status = 'paused';
  } else if (qaState === 'pickup') {
    state.obstacleInMs = 999999;
    state.logoInMs = 999999;
    state.lassoInMs = 999999;
    addEntity(state, { type: 'lasso', x: 760 });
    state.status = 'paused';
  } else if (qaState === 'damage') {
    state.hearts = 1;
    state.invulnerableMs = 1050;
    state.obstacleInMs = 999999;
    addEntity(state, { type: 'cactus', x: WORLD.riderX + WORLD.riderWidth - 26, hit: true });
    state.status = 'paused';
  } else if (qaState === 'gameover' || qaState === 'death') {
    state.status = 'gameover';
    state.hearts = 0;
    state.distance = 734;
    state.logoPoints = 1200;
    state.score = 1934;
  }
  return state;
}
