import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiError, createAuthenticationProvider, createRealApi, normalizeRequestSpec, type RequestSpec, type Transport } from '../services/api.ts';
import { mapEvent, toCreateEvent, type BackendEvent, type BackendRegistrationResult, type BackendRoadbook } from '../services/api-contract.ts';
import type { PublishEventInput, RegistrationInput } from '../types/domain.ts';

const roadbook: BackendRoadbook = {
  id: 'route-1', ownerId: 'organizer-demo', name: '西湖群山环线', description: '测试路书说明', distanceKm: 68.4,
  elevationGainM: 1060, estimatedMinutes: 240, difficulty: 'challenging', region: '杭州', coordinateSystem: 'WGS84',
  track: [
    { longitude: 120.104, latitude: 30.222 },
    { longitude: 120.096, latitude: 30.205 },
    { longitude: 120.087, latitude: 30.191 },
  ],
  elevationProfile: [35, 420, 180], maxGradient: 11.8,
  waypoints: [
    { name: '龙井集合点', type: 'start', longitude: 120.104, latitude: 30.222, distanceKm: 0 },
    { name: '梅家坞补水', type: 'water', longitude: 120.087, latitude: 30.191, distanceKm: 23.6 },
  ],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

const backendEvent: BackendEvent = {
  id: 'event-1', organizerId: 'organizer-demo', routeId: 'route-1', title: '西湖群山晨间爬坡',
  summary: '稳定拉练，设置等候点，适合有连续爬坡经验的骑友。', startAt: '2026-09-12T23:00:00.000Z',
  registrationDeadline: '2026-09-11T12:00:00.000Z', meetingPoint: '杭州龙井路停车场入口', difficulty: 'challenging',
  distanceKm: 68.4, elevationGainM: 1060, speedMinKph: 24, speedMaxKph: 29, capacity: 20, registrationCount: 3,
  equipmentRequirements: ['头盔', '前后车灯'], abilityRequirements: ['近三个月完成过 60 公里骑行', '累计爬升 800 米'],
  safetyNotice: '遵守交通规则，路线可能因天气调整。', status: 'published', createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', version: 1,
};

const auth = () => ({ Authorization: 'Bearer verified-test-token' });

test('list adapter consumes backend pages and maps event/roadbook field names', async () => {
  const transport: Transport = async <T>(spec: RequestSpec) => {
    if (spec.url.startsWith('/api/v1/events')) return { items: [backendEvent], nextCursor: null } as T;
    if (spec.url.startsWith('/api/v1/routes')) return { items: [roadbook], nextCursor: null } as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const [event] = await createRealApi(transport, 'organizer-demo', auth).listEvents();
  assert.equal(event.registeredCount, 3);
  assert.equal(event.registrationDeadline, backendEvent.registrationDeadline);
  assert.equal(event.description, backendEvent.summary);
  assert.equal(event.route.city, '杭州');
  assert.equal(event.route.durationMinutes, 240);
  assert.equal(event.route.pois.length, 2);
  assert.equal(event.route.track.length, roadbook.track.length);
  assert.deepEqual(event.route.elevationProfile, roadbook.elevationProfile);
  assert.equal(event.route.maxGradient, 11.8);
  assert.notEqual(event.route.track[0].longitude, roadbook.track[0].longitude);
  assert.equal(event.ownedByMe, true);
});

test('editing an event removes duplicated generated ability text before resubmission', () => {
  const corrupted = {
    ...backendEvent,
    abilityRequirements: [
      '近 30 天完成过 30 公里骑行', '近 30 天累计爬升 30 米', '允许车型：公路车',
      '听从领队指挥', '保持安全车距',
      '近 30 天完成过 30 公里骑行；近 30 天累计爬升 30 米；允许车型：公路车；听从领队指挥；保持安全车距',
    ],
  };
  const event = mapEvent(corrupted, undefined, 'organizer-demo');
  assert.equal(event.requirements.customNote, '');
  assert.deepEqual(event.requirements.bikeTypes, ['公路车']);
  assert.deepEqual(event.requirements.disciplines, ['听从领队指挥', '保持安全车距']);

  const payload = toCreateEvent({
    title: event.title, date: '2026-09-13', time: '07:00', meetingPoint: event.meetingPoint,
    routeId: '', distanceKm: event.route.distanceKm, elevationGainM: event.route.elevationGainM,
    difficulty: event.route.difficulty, capacity: event.capacity, speedRange: event.speedRange,
    description: event.description, requirements: event.requirements,
  });
  assert.equal(payload.abilityRequirements.length, 5);
  assert.ok(payload.abilityRequirements.every((item) => item.length <= 200));
});

test('registration sends the encrypted-field payload contract and keeps one supplied idempotency key', async () => {
  let captured: RequestSpec | undefined;
  const result: BackendRegistrationResult = {
    registration: { id: 'reg-1', eventId: 'event-1', userId: 'user-1', status: 'active', abilityConfirmed: true, equipmentConfirmed: true, waiverVersion: 'v1.0', waiverAcceptedAt: '2026-08-02T00:00:00.000Z', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', cancelledAt: null },
    event: backendEvent, replayed: false,
  };
  const transport: Transport = async <T>(spec: RequestSpec) => { captured = spec; return result as T; };
  const input: RegistrationInput = { phone: '13800006721', emergencyContact: '林先生 13600001048', bikeType: '公路车', abilityConfirmed: true, waiverConfirmed: true };
  const registration = await createRealApi(transport, 'user-1', auth).register('event-1', input, 'intent-event-1-100');
  assert.equal(registration.status, 'approved');
  assert.deepEqual(captured?.data, {
    phone: input.phone,
    emergencyContact: input.emergencyContact,
    bikeType: input.bikeType,
    abilityConfirmed: true,
    equipmentConfirmed: true,
    waiverVersion: 'v1.0',
  });
  assert.equal(captured?.header?.['Idempotency-Key'], 'intent-event-1-100');
  assert.equal(captured?.header?.Authorization, 'Bearer verified-test-token');
  assert.equal(captured?.header?.['x-user-id'], undefined);
});

test('authentication provider exchanges one WeChat code and reuses the stored bearer token', async () => {
  const values = new Map<string, unknown>();
  let exchangeCount = 0;
  const transport: Transport = async <T>(spec: RequestSpec) => {
    assert.equal(spec.url, '/api/v1/auth/wechat/login');
    exchangeCount += 1;
    return { accessToken: 'issued-token', expiresIn: 604800, user: { id: 'user-1' } } as T;
  };
  const provider = createAuthenticationProvider(
    transport,
    async () => 'wechat-temporary-code',
    { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
  );
  const [first, concurrent] = await Promise.all([provider(), provider()]);
  const reused = await provider();
  assert.deepEqual(first, { Authorization: 'Bearer issued-token' });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(reused, first);
  assert.equal(exchangeCount, 1);
  assert.equal((values.get('demo_account') as { id: string }).id, 'user-1');
});

test('phone login exchanges WeChat login and phone codes and stores the session', async () => {
  const originalWx = (globalThis as { wx?: unknown }).wx;
  const values = new Map<string, unknown>();
  const calls: RequestSpec[] = [];
  (globalThis as any).wx = {
    login: ({ success }: { success: (result: { code: string }) => void }) => success({ code: 'wechat-login-code' }),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
  };
  const profile = { id: 'phone-user', nickname: '微信骑友', avatarUrl: null, phoneMasked: '138****8000' };
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { accessToken: 'issued-phone-token', expiresIn: 604800, user: { id: 'phone-user', profile } } as T;
  };
  try {
    await createRealApi(transport, 'phone-user', auth).phoneLogin('phone-auth-code');
    assert.deepEqual(calls[0].data, { loginCode: 'wechat-login-code', phoneCode: 'phone-auth-code' });
    assert.equal(calls[0].url, '/api/v1/auth/wechat/phone-login');
    assert.equal(values.get('auth_token'), 'issued-phone-token');
    assert.deepEqual(values.get('demo_account'), profile);
  } finally {
    if (originalWx === undefined) delete (globalThis as { wx?: unknown }).wx;
    else (globalThis as { wx?: unknown }).wx = originalWx;
  }
});

test('authenticated user binds an official WeChat phone code', async () => {
  const calls: RequestSpec[] = [];
  const profile = { id: 'user-1', nickname: '微信骑友', avatarUrl: null, phoneMasked: '138****8000' };
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { profile } as T;
  };
  const result = await createRealApi(transport, 'user-1', auth).bindPhone('phone-auth-code');
  assert.deepEqual(result, profile);
  assert.equal(calls[0].url, '/api/v1/me/phone');
  assert.deepEqual(calls[0].data, { code: 'phone-auth-code' });
  assert.equal(calls[0].header?.Authorization, 'Bearer verified-test-token');
});

test('public event detail remains available when login is unavailable', async () => {
  const calls: string[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec.url);
    if (spec.url === '/api/v1/events/event-1') return backendEvent as T;
    if (spec.url === '/api/v1/routes/route-1') return roadbook as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const unavailableAuth = async (): Promise<Record<string, string>> => { throw new Error('login unavailable'); };
  const event = await createRealApi(transport, 'user-1', unavailableAuth).getEvent('event-1');
  assert.equal(event.id, 'event-1');
  assert.deepEqual(calls, ['/api/v1/events/event-1', '/api/v1/routes/route-1']);
});

test('public participant list exposes only rider identity fields without authentication', async () => {
  const calls: RequestSpec[] = [];
  const items = [
    { nickname: '骑行小明', avatarUrl: 'https://cyclewhereapi.alexcld.com/api/v1/avatars/rider-1.jpg', isOrganizer: true },
    { nickname: null, avatarUrl: null, isOrganizer: false },
  ];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { items } as T;
  };
  const participants = await createRealApi(transport, 'user-1', auth).getEventParticipants('event-1');
  assert.deepEqual(participants, items);
  assert.equal(calls[0].url, '/api/v1/events/event-1/participants');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].header?.Authorization, 'Bearer verified-test-token');
});

test('organizer contact adapter uses the protected event participant endpoint', async () => {
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { nickname: '骑行小明', avatarUrl: null, phone: '13800138000', emergencyContact: '林先生 13600001048', bikeType: '公路车' } as T;
  };
  const contact = await createRealApi(transport, 'organizer-demo', auth).getEventParticipantContact('event-1', 'contact-1');
  assert.equal(contact.phone, '13800138000');
  assert.equal(calls[0].url, '/api/v1/events/event-1/participants/contact-1/contact');
  assert.equal(calls[0].header?.Authorization, 'Bearer verified-test-token');
});

test('organizer cancellation uses the protected event cancel endpoint', async () => {
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { ...backendEvent, status: 'cancelled' } as T;
  };
  await createRealApi(transport, 'organizer-demo', auth).cancelEvent('event-1');
  assert.equal(calls[0].url, '/api/v1/events/event-1/cancel');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].header?.Authorization, 'Bearer verified-test-token');
});

test('protected request refreshes a rejected bearer token once', async () => {
  const refreshFlags: Array<boolean | undefined> = [];
  let requestCount = 0;
  const transport: Transport = async <T>(spec: RequestSpec) => {
    requestCount += 1;
    if (requestCount === 1) throw new ApiError('登录已过期', 401, 'UNAUTHORIZED');
    assert.equal(spec.header?.Authorization, 'Bearer refreshed-token');
    return { items: [] } as T;
  };
  const authProvider = async (forceRefresh?: boolean) => {
    refreshFlags.push(forceRefresh);
    return { Authorization: `Bearer ${forceRefresh ? 'refreshed-token' : 'stale-token'}` };
  };
  const records = await createRealApi(transport, 'user-1', authProvider).getMyRegistrationRecords();
  assert.deepEqual(records, []);
  assert.deepEqual(refreshFlags, [undefined, true]);
  assert.equal(requestCount, 2);
});

test('my registrations uses the JWT aggregate endpoint and keeps historical event data', async () => {
  const cancelledRegistration = {
    id: 'reg-history', eventId: backendEvent.id, userId: 'user-1', status: 'cancelled' as const,
    abilityConfirmed: true, equipmentConfirmed: true, waiverVersion: 'v1.0', waiverAcceptedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', cancelledAt: '2026-08-03T00:00:00.000Z',
  };
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { items: [{ registration: cancelledRegistration, event: { ...backendEvent, status: 'completed' } }] } as T;
  };
  const records = await createRealApi(transport, 'user-1', auth).getMyRegistrationRecords();
  assert.deepEqual(calls.map((item) => item.url), ['/api/v1/me/registrations']);
  assert.equal(calls[0].header?.Authorization, 'Bearer verified-test-token');
  assert.equal(records[0].registration.status, 'cancelled');
  assert.equal(records[0].event.status, 'completed');
  assert.equal(records[0].event.registrationDeadline, backendEvent.registrationDeadline);
});

test('publish adapter creates a draft then calls publish endpoint', async () => {
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    if (spec.url === '/api/v1/routes/route-1') return roadbook as T;
    if (spec.url === '/api/v1/events') return { ...backendEvent, status: 'draft' } as T;
    if (spec.url === '/api/v1/events/event-1/publish') return backendEvent as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const input: PublishEventInput = {
    title: '西湖群山晨间爬坡', date: '2026-09-13', time: '07:00', meetingPoint: '杭州龙井路停车场入口',
    routeId: 'route-1', capacity: 20, speedRange: '24-29 km/h', description: '遵守交通规则，路线可能因天气调整。',
    requirements: { equipment: ['头盔'], recentDistanceKm: 60, recentElevationM: 800, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  const event = await createRealApi(transport, 'organizer-demo', auth).publish(input);
  assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), [
    'GET /api/v1/routes/route-1', 'POST /api/v1/events', 'POST /api/v1/events/event-1/publish',
  ]);
  assert.equal((calls[1].data as { summary: string }).summary, input.description);
  assert.equal(event.status, 'published');
});

test('publish adapter allows an event without a roadbook', async () => {
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    if (spec.url === '/api/v1/events') return { ...backendEvent, routeId: null, distanceKm: 42, elevationGainM: 320, status: 'draft' } as T;
    if (spec.url === '/api/v1/events/event-1/publish') return { ...backendEvent, routeId: null, distanceKm: 42, elevationGainM: 320 } as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const input: PublishEventInput = {
    title: '城市周末骑行', date: '2026-09-13', time: '07:00', meetingPoint: '市民中心南广场',
    routeId: '', distanceKm: 42, elevationGainM: 320, difficulty: '中等', capacity: 20,
    speedRange: '22-25 km/h', description: '遵守交通规则并听从领队安排，路线现场确认。',
    requirements: { equipment: ['骑行头盔'], recentDistanceKm: 30, recentElevationM: 200, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  await createRealApi(transport, 'organizer-demo', auth).publish(input);
  assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), [
    'POST /api/v1/events', 'POST /api/v1/events/event-1/publish',
  ]);
  assert.deepEqual(calls[0].data && {
    routeId: (calls[0].data as any).routeId,
    distanceKm: (calls[0].data as any).distanceKm,
    elevationGainM: (calls[0].data as any).elevationGainM,
    difficulty: (calls[0].data as any).difficulty,
  }, { routeId: null, distanceKm: 42, elevationGainM: 320, difficulty: 'moderate' });
});

test('publish endpoint normalizes an empty JSON body', () => {
  assert.deepEqual(normalizeRequestSpec({ url: '/api/v1/events/event-1/publish', method: 'POST' }).data, {});
  assert.equal((normalizeRequestSpec({ url: '/api/v1/events', method: 'POST', data: { title: 'x' } }).data as { title: string }).title, 'x');
});

test('event edit uses the WeChat-compatible PUT endpoint with organizer authentication', async () => {
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    if (spec.url === '/api/v1/routes/route-1') return roadbook as T;
    if (spec.url === '/api/v1/events/event-1') return { ...backendEvent, title: '更新后的活动' } as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const input: PublishEventInput = {
    title: '更新后的活动', date: '2026-09-13', time: '07:00', meetingPoint: '杭州龙井路停车场入口',
    routeId: 'route-1', capacity: 20, speedRange: '24-29 km/h', description: '遵守交通规则，路线可能因天气调整。',
    requirements: { equipment: ['头盔'], recentDistanceKm: 60, recentElevationM: 800, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  const updated = await createRealApi(transport, 'organizer-demo', auth).updateEvent('event-1', input);
  assert.equal(updated.title, '更新后的活动');
  assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), [
    'GET /api/v1/routes/route-1', 'PUT /api/v1/events/event-1',
  ]);
  assert.equal(calls[1].header?.Authorization, 'Bearer verified-test-token');
});

test('profile APIs read and save the authenticated WeChat profile', async () => {
  const profile = { id: 'user-1', nickname: '骑行小明', avatarUrl: 'https://wx.qlogo.cn/avatar.png', city: '杭州' };
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { profile } as T;
  };
  const api = createRealApi(transport, 'user-1', auth);
  assert.deepEqual(await api.getProfile(), profile);
  assert.deepEqual(await api.updateProfile({ nickname: profile.nickname, avatarUrl: profile.avatarUrl, city: profile.city }), profile);
  assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), [
    'GET /api/v1/me/profile', 'PUT /api/v1/me/profile',
  ]);
  assert.ok(calls.every((item) => item.header?.Authorization === 'Bearer verified-test-token'));
});

test('supported avatar and nickname registration persists profile then uploads the selected avatar', async () => {
  const originalWx = (globalThis as { wx?: unknown }).wx;
  let avatarRequest: any;
  (globalThis as any).wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => undefined,
    getFileSystemManager: () => ({
      readFile: ({ success }: { success: (result: unknown) => void }) => success({ data: 'ZmFrZS1hdmF0YXI=' }),
    }),
    request: (request: unknown) => {
      avatarRequest = request;
      (request as { success: (result: unknown) => void }).success({
        statusCode: 201,
        data: { data: { profile: { id: 'user-1', nickname: '骑行小明', avatarUrl: 'https://cyclewhereapi.alexcld.com/api/v1/avatars/user-1.jpg', city: null } } },
      });
    },
  };
  const calls: RequestSpec[] = [];
  const profile = { id: 'user-1', nickname: '骑行小明', avatarUrl: 'https://cyclewhereapi.alexcld.com/api/v1/avatars/user-1.jpg', city: null };
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { profile } as T;
  };
  try {
    const result = await createRealApi(transport, 'user-1', auth).registerProfile('骑行小明', 'wxfile://selected-avatar.jpg', true);
    assert.deepEqual(result, profile);
    assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), ['PUT /api/v1/me/profile']);
    assert.deepEqual(calls[0].data, {
      nickname: '骑行小明', avatarUrl: null, gender: null,
      country: null, province: null, city: null,
    });
    assert.equal(avatarRequest.url, 'https://cyclewhereapi.alexcld.com/api/v1/me/avatar/base64');
    assert.equal(avatarRequest.method, 'POST');
    assert.equal(avatarRequest.data.data, 'ZmFrZS1hdmF0YXI=');
    assert.equal(avatarRequest.header.Authorization, 'Bearer verified-test-token');
  } finally {
    if (originalWx === undefined) delete (globalThis as { wx?: unknown }).wx;
    else (globalThis as { wx?: unknown }).wx = originalWx;
  }
});
