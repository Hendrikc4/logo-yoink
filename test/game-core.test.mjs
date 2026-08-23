import test from 'node:test';
import assert from 'node:assert/strict';
import { CACTUS_SIZES, WORLD, addEntity, createGame, jump, startGame, stepGame } from '../public/game-core.js';

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
  const tallestCactusTop = WORLD.groundY - Math.max(...CACTUS_SIZES.map(size => size.height));
  assert.ok(riderCollisionBottomAtPeak < tallestCactusTop - 40);
});

test('cactus variants have three clearly different grounded sizes', () => {
  assert.deepEqual(CACTUS_SIZES.map(size => size.variant), ['small', 'medium', 'tall']);
  assert.ok(CACTUS_SIZES[1].height - CACTUS_SIZES[0].height >= 20);
  assert.ok(CACTUS_SIZES[2].height - CACTUS_SIZES[1].height >= 20);
  assert.ok(CACTUS_SIZES.every(size => size.width > 0 && size.height > 0));
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

test('logo collision awards one hundred points', () => {
  const state = running();
  addEntity(state, { type: 'logo', x: WORLD.riderX + 80, y: state.rider.y + 50 });
  stepGame(state, 20);
  assert.equal(state.logoPoints, 100);
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
  assert.equal(state.logoPoints, 300);
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
