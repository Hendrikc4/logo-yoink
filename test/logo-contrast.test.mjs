import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastingPreviewBackground } from '../public/logo-contrast.js';

test('dark logo pixels receive a white preview background', () => {
  assert.equal(contrastingPreviewBackground(new Uint8ClampedArray([
    10, 18, 28, 255,
    35, 20, 60, 255,
    255, 255, 255, 0,
  ])), 'white');
});

test('light logo pixels receive a black preview background', () => {
  assert.equal(contrastingPreviewBackground(new Uint8ClampedArray([
    255, 255, 255, 255,
    245, 220, 90, 255,
    0, 0, 0, 0,
  ])), 'black');
});

test('an empty transparent image falls back to the safer white background', () => {
  assert.equal(contrastingPreviewBackground(new Uint8ClampedArray([0, 0, 0, 0])), 'white');
});
