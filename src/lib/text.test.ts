import assert from 'node:assert/strict';
import test from 'node:test';
import { splitBio } from './text';

test('bio segmentation preserves Chinese, astral emoji and combining sequences', () => {
  const bio = '你好 👨‍👩‍👧‍👦 e\u0301 🌟';
  assert.equal(splitBio(bio).join(''), bio);
  assert.ok(splitBio(bio).includes('👨‍👩‍👧‍👦'));
});

test('bio remains complete when Intl.Segmenter is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  try {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    const bio = '你好 👨‍👩‍👧‍👦 e\u0301 🌟';
    assert.deepEqual(splitBio(bio), Array.from(bio));
    assert.equal(splitBio(bio).join(''), bio);
    assert.deepEqual(splitBio(''), []);
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    else Reflect.deleteProperty(Intl, 'Segmenter');
  }
});
