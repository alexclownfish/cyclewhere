import { API_BASE_URL, USE_MOCK, WAIVER_VERSION } from '../config/env';
import type { ApiEnvelope, MyRegistrationRecord, PublishEventInput, Registration, RegistrationInput, RideEvent, RideRoute } from '../types/domain';
import { mockApi } from './mock-api';
import {
  mapEvent, mapRegistration, mapRoadbook, toCreateEvent,
  type BackendEvent, type BackendPage, type BackendRegistrationResult, type BackendRoadbook, type BackendUserRegistration,
} from './api-contract';

export interface RequestSpec {
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer;
  header?: Record<string, string>;
}

export type Transport = <T>(spec: RequestSpec) => Promise<T>;

export interface ClientApi {
  listEvents(): Promise<RideEvent[]>;
  getEvent(id: string): Promise<RideEvent>;
  listRoutes(): Promise<RideRoute[]>;
  getRoute(id: string): Promise<RideRoute>;
  getRegistrationStatus(eventId: string): Promise<Registration | null>;
  getMyRegistrationRecords(): Promise<MyRegistrationRecord[]>;
  register(eventId: string, input: RegistrationInput, idempotencyKey: string): Promise<Registration>;
  cancelRegistration(eventId: string): Promise<void>;
  publish(input: PublishEventInput): Promise<RideEvent>;
}

function wxTransport<T>(spec: RequestSpec): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request<ApiEnvelope<T>>({
      ...spec,
      url: `${API_BASE_URL}${spec.url}`,
      header: { 'content-type': 'application/json', ...spec.header },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data.data);
        else {
          if (response.statusCode === 401) wx.removeStorageSync('auth_token');
          reject(new Error(`请求失败（${response.statusCode}）`));
        }
      },
      fail: () => reject(new Error('网络不可用，请稍后重试')),
    });
  });
}

interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string };
}

function wechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => wx.login({
    success: ({ code }) => code ? resolve(code) : reject(new Error('微信登录失败')),
    fail: () => reject(new Error('微信登录失败')),
  }));
}

async function authenticationHeaders(): Promise<Record<string, string>> {
  return realAuthenticationHeaders();
}

export interface AuthStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function createAuthenticationProvider(
  transport: Transport,
  getLoginCode: () => Promise<string>,
  storage: AuthStorage,
): () => Promise<Record<string, string>> {
  let pending: Promise<Record<string, string>> | null = null;
  return async () => {
    const storedToken = storage.get('auth_token');
    if (typeof storedToken === 'string' && storedToken) return { Authorization: `Bearer ${storedToken}` };
    if (!pending) pending = (async () => {
      const result = await transport<LoginResult>({
        url: '/api/v1/auth/wechat/login', method: 'POST', data: { code: await getLoginCode() },
      });
      storage.set('auth_token', result.accessToken);
      storage.set('demo_account', { id: result.user.id, nickname: '微信骑友', city: '' });
      return { Authorization: `Bearer ${result.accessToken}` };
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}

const realAuthenticationHeaders = typeof wx === 'undefined'
  ? async () => ({})
  : createAuthenticationProvider(wxTransport, wechatLogin, {
      get: (key) => wx.getStorageSync(key),
      set: (key, value) => wx.setStorageSync(key, value),
    });

type HeaderProvider = () => Record<string, string> | Promise<Record<string, string>>;
type UserProvider = string | (() => string);

export function createRealApi(transport: Transport, currentUser: UserProvider, authHeaders: HeaderProvider): ClientApi {
  const currentUserId = () => typeof currentUser === 'function' ? currentUser() : currentUser;
  async function loadAllPages<T>(url: string): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: BackendPage<T> = await transport<BackendPage<T>>({ url: `${url}${suffix}`, method: 'GET' });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }
  const loadRoadbooks = () => loadAllPages<BackendRoadbook>('/api/v1/routes?limit=100');
  const loadEvents = () => loadAllPages<BackendEvent>('/api/v1/events?limit=100');

  return {
    async listEvents() {
      const [events, roadbooks] = await Promise.all([loadEvents(), loadRoadbooks()]);
      const routeById = new Map(roadbooks.map((item) => [item.id, mapRoadbook(item)]));
      return events.map((item) => mapEvent(item, item.routeId ? routeById.get(item.routeId) : undefined, currentUserId()));
    },
    async getEvent(id) {
      const event = await transport<BackendEvent>({ url: `/api/v1/events/${id}`, method: 'GET', header: await authHeaders() });
      const route = event.routeId
        ? mapRoadbook(await transport<BackendRoadbook>({ url: `/api/v1/routes/${event.routeId}`, method: 'GET' }))
        : undefined;
      return mapEvent(event, route, currentUserId());
    },
    async listRoutes() {
      return (await loadRoadbooks()).map(mapRoadbook);
    },
    async getRoute(id) {
      return mapRoadbook(await transport<BackendRoadbook>({ url: `/api/v1/routes/${id}`, method: 'GET' }));
    },
    async getRegistrationStatus(eventId) {
      const status = await transport<BackendUserRegistration['registration'] | null>({
        url: `/api/v1/events/${eventId}/registration-status`, method: 'GET', header: await authHeaders(),
      });
      return status ? mapRegistration(status) : null;
    },
    async getMyRegistrationRecords() {
      const headers = await authHeaders();
      const result = await transport<{ items: BackendUserRegistration[] }>({
        url: '/api/v1/me/registrations', method: 'GET', header: headers,
      });
      return result.items.map((item) => ({
        registration: mapRegistration(item.registration),
        event: mapEvent(item.event, undefined, currentUserId()),
      }));
    },
    async register(eventId, input, idempotencyKey) {
      const result = await transport<BackendRegistrationResult>({
        url: `/api/v1/events/${eventId}/registrations`, method: 'POST',
        header: { ...(await authHeaders()), 'Idempotency-Key': idempotencyKey },
        data: {
          phone: input.phone,
          emergencyContact: input.emergencyContact,
          bikeType: input.bikeType,
          abilityConfirmed: input.abilityConfirmed,
          equipmentConfirmed: input.abilityConfirmed,
          waiverVersion: WAIVER_VERSION,
        },
      });
      return mapRegistration(result.registration);
    },
    async cancelRegistration(eventId) {
      await transport<BackendRegistrationResult>({ url: `/api/v1/events/${eventId}/registrations/me`, method: 'DELETE', header: await authHeaders() });
    },
    async publish(input) {
      const roadbook = await transport<BackendRoadbook>({ url: `/api/v1/routes/${input.routeId}`, method: 'GET' });
      const route = mapRoadbook(roadbook);
      const headers = await authHeaders();
      const draft = await transport<BackendEvent>({ url: '/api/v1/events', method: 'POST', header: headers, data: toCreateEvent(input, route) });
      const published = await transport<BackendEvent>({ url: `/api/v1/events/${draft.id}/publish`, method: 'POST', header: headers });
      return mapEvent(published, route, currentUserId());
    },
  };
}

const realApi = createRealApi(
  wxTransport,
  () => wx.getStorageSync('demo_account')?.id || '',
  authenticationHeaders,
);

export const api: ClientApi = USE_MOCK ? {
  ...mockApi,
  register: (eventId, input) => mockApi.register(eventId, input),
} : realApi;
