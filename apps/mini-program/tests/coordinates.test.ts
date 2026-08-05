import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { wgs84ToGcj02 } from '../utils/coordinates.ts';

test('WGS84 coordinate in China is converted for WeChat map display', () => {
  const source = { latitude: 39.908823, longitude: 116.39747 };
  const converted = wgs84ToGcj02(source);
  assert.ok(Math.abs(converted.latitude - source.latitude) > .001);
  assert.ok(Math.abs(converted.longitude - source.longitude) > .001);
  assert.ok(Math.abs(converted.latitude - source.latitude) < .02);
  assert.deepEqual(source, { latitude: 39.908823, longitude: 116.39747 });
});

test('coordinates outside China stay in WGS84', () => {
  const source = { latitude: 51.5074, longitude: -0.1278 };
  assert.deepEqual(wgs84ToGcj02(source), source);
});
