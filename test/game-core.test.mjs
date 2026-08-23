import test from 'node:test';
import assert from 'node:assert/strict';
import { CACTUS_SIZES, CACTUS_TYPES, LOGO_POINTS, WORLD, addEntity, createGame, jump, startGame, stepGame, strideFrame } from '../public/game-core.js';

function running(seed = 42) {
  const state = createGame({ seed, logoCount: 12 });
  startGame(state);
  state.obstacleInMs = 999999;
  state.logoInMs = 999999;
  state.lassoInMs = 999999;
  return state;
}

test('seeded runs spawn deterministically', () => {
  const a = createGame({ seed: 99 });
  const b = createGame({ seed: 99 });
  startGame(a); startGame(b);
  for (let i = 0; i < 500; i++) { stepGame(a, 20); stepGame(b, 20); }
  assert.deepEqual(a.entities, b.entities);
  assert.equal(a.score, b.score);
});

test('distance is independent of supplied frame chunks', () => {
  const a = running(); const b = running();
  for (let i = 0; i < 100; i++) stepGame(a, 20);
  for (let i = 0; i < 20; i++) stepGame(b, 100);
  assert.equal(a.distance, b.distance);
  assert.equal(a.score, b.score);
});

test('foreground travel stays exactly synchronized with cactus movement', () => {
  const state = createGame({ seed: 7 });
  startGame(state);
  state.obstacleInMs = 999999;
  state.logoInMs = 999999;
  state.lassoInMs = 999999;
  const cactus = addEntity(state, { type: 'cactus', x: 1100 });
  stepGame(state, 400);
  assert.ok(Math.abs((1100 - cactus.x) - state.travelPx) < 1e-9);
});

test('jump only starts from the ground and lands again', () => {
  const state = running();
  assert.equal(jump(state), true);
  assert.equal(jump(state), false);
  for (let i = 0; i < 100; i++) stepGame(state, 20);
  assert.equal(state.rider.onGround, true);
  assert.equal(state.rider.y, WORLD.groundY - WORLD.riderHeight);
});

test('jump arc clears the tallest cactus with a forgiving margin', () => {
  const state = running();
  jump(state);
  let highestY = state.rider.y;
  for (let i = 0; i < 120; i++) {
    stepGame(state, 20);
    highestY = Math.min(highestY, state.rider.y);
  }
  const riderCollisionBottomAtPeak = highestY + 30 + WORLD.riderHeight - 45;
  const tallestCactus = Math.max(...CACTUS_SIZES.flatMap(size => CACTUS_TYPES.map(type => Math.round(size.height * type.heightScale))));
  const tallestCactusTop = WORLD.groundY - tallestCactus;
  assert.ok(riderCollisionBottomAtPeak < tallestCactusTop - 40);
});

test('cactus variants have three clearly different grounded sizes', () => {
  assert.deepEqual(CACTUS_SIZES.map(size => size.variant), ['small', 'medium', 'tall']);
  assert.ok(CACTUS_SIZES[1].height - CACTUS_SIZES[0].height >= 20);
  assert.ok(CACTUS_SIZES[2].height - CACTUS_SIZES[1].height >= 20);
  assert.ok(CACTUS_SIZES.every(size => size.width > 0 && size.height > 0));
});

test('cactus artwork exposes three distinct silhouettes', () => {
  assert.deepEqual(CACTUS_TYPES.map(type => type.id), ['classic', 'forked', 'prickly-pear']);
  assert.equal(new Set(CACTUS_TYPES.map(type => `${type.widthScale}:${type.heightScale}`)).size, 3);
});

test('first lasso arrives during the opening four seconds', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const state = createGame({ seed });
    assert.ok(state.lassoInMs >= 2000 && state.lassoInMs <= 4000);
  }
});

test('lassos return frequently after collection or a miss', () => {
  const collected = running();
  addEntity(collected, { type: 'lasso', x: WORLD.riderX + 80 });
  stepGame(collected, 20);
  assert.equal(collected.lassoCharges, 3);
  assert.ok(collected.lassoInMs >= 10000 && collected.lassoInMs <= 15000);

  const missed = running();
  missed.lassoInMs = Number.POSITIVE_INFINITY;
  addEntity(missed, { type: 'lasso', x: -205 });
  stepGame(missed, 20);
  assert.ok(missed.lassoInMs >= 6000 && missed.lassoInMs <= 10000);
});

test('stride animation advances only with world travel', () => {
  const state = createGame();
  state.travelPx = 51;
  assert.equal(strideFrame(state, 4), 0);
  state.travelPx = 52;
  assert.equal(strideFrame(state, 4), 1);
  state.travelPx = 104;
  assert.equal(strideFrame(state, 4), 2);
  state.travelPx = 208;
  assert.equal(strideFrame(state, 4), 0);
});

test('the first cactus hit ends a one-life run', () => {
  const state = running();
  addEntity(state, { type: 'cactus', x: WORLD.riderX + 80 });
  stepGame(state, 20);
  assert.equal(state.hearts, 0);
  assert.equal(state.status, 'gameover');
});

test('runner speed increases substantially with distance and remains capped', () => {
  const state = running();
  const startingSpeed = state.speed;
  for (let index = 0; index < 3000; index++) stepGame(state, 20);
  assert.ok(state.speed > startingSpeed + 350);
  assert.ok(state.speed <= 740);
});

test('ordinary logo collision awards the full logo bonus', () => {
  const state = running();
  addEntity(state, { type: 'logo', x: WORLD.riderX + 80, y: state.rider.y + 50 });
  stepGame(state, 20);
  assert.equal(state.logoPoints, LOGO_POINTS);
  assert.equal(state.collected, 1);
});

test('lasso auto-yoinks exactly three logos', () => {
  const state = running();
  state.lassoCharges = 3;
  const yoinkEvents = [];
  for (let index = 0; index < 4; index++) {
    addEntity(state, { type: 'logo', x: WORLD.riderX + 300, y: 100, logoIndex: index });
    stepGame(state, 20);
    yoinkEvents.push(...state.events.filter(event => event.type === 'yoink'));
  }
  assert.equal(state.lassoCharges, 0);
  assert.equal(state.collected, 3);
  assert.equal(state.logoPoints, LOGO_POINTS * 3);
  assert.equal(yoinkEvents.length, 3);
  assert.equal(state.entities.filter(entity => entity.type === 'logo').length, 1);
});

test('obstacle respawn gap grows from jump airtime and speed', () => {
  const state = running();
  state.obstacleInMs = 0;
  stepGame(state, 20);
  const minimum = (state.speed * 1.32 + 170) / state.speed * 1000;
  assert.ok(state.obstacleInMs >= minimum - WORLD.tickMs);
});
