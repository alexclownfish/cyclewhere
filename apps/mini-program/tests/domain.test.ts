import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PublishEventInput, RegistrationInput } from '../types/domain.ts';
import { canRegister, formatDuration, makeIdempotencyKey, remainingPlaces, validatePublish, validateRegistration } from '../utils/domain.ts';

const registration: RegistrationInput = {
  phone: '13800006721', emergencyContact: '林先生 13600001048', bikeType: '公路车',
  abilityConfirmed: true, waiverConfirmed: true,
};

test('remaining places never becomes negative and full events reject registration', () => {
  const deadline = '2026-08-10T12:00:00.000Z';
  const beforeDeadline = Date.parse(deadline) - 1;
  assert.equal(remainingPlaces({ capacity: 20, registeredCount: 13 }), 7);
  assert.equal(remainingPlaces({ capacity: 20, registeredCount: 22 }), 0);
  assert.equal(canRegister({ status: 'published', capacity: 20, registeredCount: 19, registrationDeadline: deadline }, beforeDeadline), true);
  assert.equal(canRegister({ status: 'full', capacity: 20, registeredCount: 19, registrationDeadline: deadline }, beforeDeadline), false);
  assert.equal(canRegister({ status: 'published', capacity: 20, registeredCount: 20, registrationDeadline: deadline }, beforeDeadline), false);
  assert.equal(canRegister({ status: 'published', capacity: 20, registeredCount: 19, registrationDeadline: deadline }, Date.parse(deadline)), false);
  assert.equal(canRegister({ status: 'published', capacity: 20, registeredCount: 19, registrationDeadline: deadline }, Date.parse(deadline) + 1), false);
});

test('registration validation requires phone, emergency contact and both confirmations', () => {
  assert.equal(validateRegistration(registration).valid, true);
  assert.deepEqual(validateRegistration({ ...registration, phone: '123' }), { valid: false, message: '请输入有效的 11 位手机号' });
  assert.equal(validateRegistration({ ...registration, abilityConfirmed: false }).valid, false);
  assert.equal(validateRegistration({ ...registration, waiverConfirmed: false }).valid, false);
});

test('publish validation enforces structured safety requirements', () => {
  const input: PublishEventInput = {
    title: '十三陵水库周末拉练', date: '2026-08-15', time: '06:30', meetingPoint: '北邵洼地铁站 B 口',
    routeId: 'route-shisanling', capacity: 16, speedRange: '23-26 km/h', description: '遵守交通规则并听从领队安排。',
    requirements: { equipment: ['骑行头盔'], recentDistanceKm: 50, recentElevationM: 400, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  assert.equal(validatePublish(input).valid, true);
  assert.equal(validatePublish({ ...input, capacity: 1 }).valid, false);
  assert.equal(validatePublish({ ...input, requirements: { ...input.requirements, equipment: [] } }).valid, false);
  assert.equal(validatePublish({ ...input, requirements: { ...input.requirements, bikeTypes: [] } }).valid, false);
  assert.equal(validatePublish({ ...input, requirements: { ...input.requirements, disciplines: [] } }).valid, false);
});

test('presentation helpers are stable', () => {
  assert.equal(formatDuration(190), '3h 10m');
  assert.equal(makeIdempotencyKey('evt', 100), 'registration-evt-100');
});
