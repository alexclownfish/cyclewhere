import { API_BASE_URL, USE_MOCK, WAIVER_VERSION } from '../config/env';
import type { ApiEnvelope, MyRegistrationRecord, PublishEventInput, Registration, RegistrationInput, RideEvent, RideRoute, UserProfile } from '../types/domain';
import { mockApi } from './mock-api';
import {
  mapEvent, mapRegistration, mapRoadbook, toCreateEvent,
  type BackendEvent, type BackendPage, type BackendRegistrationResult, type BackendRoadbook, type BackendUserRegistration,
} from './api-contract';

export interface RequestSpec {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer;
  header?: Record<string, string>;
}

export type Transport = <T>(spec: RequestSpec) => Promise<T>;

export function normalizeRequestSpec(spec: RequestSpec): RequestSpec {
  return ['POST', 'PUT'].includes(spec.method) && spec.data === undefined ? { ...spec, data: {} } : spec;
}

export class ApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientApi {
  login(forceRefresh?: boolean): Promise<void>;
  registerProfile(nickname: string, avatarFilePath: string, forceRefresh?: boolean): Promise<UserProfile>;
  listEvents(): Promise<RideEvent[]>;
  getEvent(id: string): Promise<RideEvent>;
  listRoutes(): Promise<RideRoute[]>;
  getRoute(id: string): Promise<RideRoute>;
  getRegistrationStatus(eventId: string): Promise<Registration | null>;
  getMyRegistrationRecords(): Promise<MyRegistrationRecord[]>;
  register(eventId: string, input: RegistrationInput, idempotencyKey: string): Promise<Registration>;
  cancelRegistration(eventId: string): Promise<void>;
  publish(input: PublishEventInput): Promise<RideEvent>;
  updateEvent(id: string, input: PublishEventInput): Promise<RideEvent>;
  getProfile(): Promise<UserProfile | null>;
  updateProfile(profile: Omit<UserProfile, 'id'>): Promise<UserProfile>;
  importGpx(filePath: string, fileName?: string): Promise<RideRoute>;
}

function wxTransport<T>(spec: RequestSpec): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestSpec = normalizeRequestSpec(spec);
    wx.request<ApiEnvelope<T>>({
      ...requestSpec,
      url: `${API_BASE_URL}${spec.url}`,
      header: { 'content-type': 'application/json', ...spec.header },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data.data);
        else {
          const payload = response.data as unknown as { error?: { code?: string; message?: string } };
          reject(new ApiError(payload.error?.message || `请求失败（${response.statusCode}）`, response.statusCode, payload.error?.code || 'HTTP_ERROR'));
        }
      },
      fail: (error) => {
        const domainBlocked = error.errMsg.includes('url not in domain list');
        reject(new ApiError(domainBlocked ? 'API 域名未加入小程序 request 合法域名' : '网络不可用，请稍后重试', 0, domainBlocked ? 'DOMAIN_NOT_ALLOWED' : 'NETWORK_ERROR'));
      },
    });
  });
}

interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string; profile?: UserProfile | null };
}

function wechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => wx.login({
    success: ({ code }) => code ? resolve(code) : reject(new Error('微信登录失败')),
    fail: (error) => reject(new ApiError(`微信登录失败：${error.errMsg}`, 0, 'WX_LOGIN_FAILED')),
  }));
}

async function authenticationHeaders(forceRefresh = false): Promise<Record<string, string>> {
  return realAuthenticationHeaders(forceRefresh);
}

export interface AuthStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove?(key: string): void;
}

export function createAuthenticationProvider(
  transport: Transport,
  getLoginCode: () => Promise<string>,
  storage: AuthStorage,
): (forceRefresh?: boolean) => Promise<Record<string, string>> {
  let pending: Promise<Record<string, string>> | null = null;
  return async (forceRefresh = false) => {
    if (forceRefresh) storage.remove?.('auth_token');
    const storedToken = storage.get('auth_token');
    if (typeof storedToken === 'string' && storedToken) return { Authorization: `Bearer ${storedToken}` };
    if (!pending) pending = (async () => {
      const result = await transport<LoginResult>({
        url: '/api/v1/auth/wechat/login', method: 'POST', data: { code: await getLoginCode() },
      });
      storage.set('auth_token', result.accessToken);
      storage.set('demo_account', result.user.profile
        ? { ...result.user.profile, id: result.user.id }
        : { id: result.user.id, nickname: '微信骑友', city: '' });
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
      remove: (key) => wx.removeStorageSync(key),
    });

type HeaderProvider = (forceRefresh?: boolean) => Record<string, string> | Promise<Record<string, string>>;
type UserProvider = string | (() => string);

export function createRealApi(transport: Transport, currentUser: UserProvider, authHeaders: HeaderProvider): ClientApi {
  const currentUserId = () => typeof currentUser === 'function' ? currentUser() : currentUser;
  async function protectedRequest<T>(spec: RequestSpec): Promise<T> {
    try {
      return await transport<T>({ ...spec, header: { ...spec.header, ...(await authHeaders()) } });
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
      return transport<T>({ ...spec, header: { ...spec.header, ...(await authHeaders(true)) } });
    }
  }
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
    async login(forceRefresh = false) {
      await authHeaders(forceRefresh);
    },
    async registerProfile(nickname, avatarFilePath, forceRefresh = false) {
      await authHeaders(forceRefresh);
      try {
        await this.updateProfile({
          nickname: nickname.trim(), avatarUrl: null, gender: null,
          country: null, province: null, city: null,
        });
        const result = await uploadAvatarBase64(avatarFilePath, await authHeaders());
        return result.profile;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 404) {
          throw new ApiError('服务器尚未升级用户资料接口，请先部署最新后端', 503, 'PROFILE_ENDPOINT_MISSING');
        }
        throw error;
      }
    },
    async listEvents() {
      const [events, roadbooks] = await Promise.all([loadEvents(), loadRoadbooks()]);
      const routeById = new Map(roadbooks.map((item) => [item.id, mapRoadbook(item)]));
      return events.map((item) => mapEvent(item, item.routeId ? routeById.get(item.routeId) : undefined, currentUserId()));
    },
    async getEvent(id) {
      const event = await transport<BackendEvent>({ url: `/api/v1/events/${id}`, method: 'GET' });
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
      const status = await protectedRequest<BackendUserRegistration['registration'] | null>({
        url: `/api/v1/events/${eventId}/registration-status`, method: 'GET',
      });
      return status ? mapRegistration(status) : null;
    },
    async getMyRegistrationRecords() {
      const result = await protectedRequest<{ items: BackendUserRegistration[] }>({
        url: '/api/v1/me/registrations', method: 'GET',
      });
      return result.items.map((item) => ({
        registration: mapRegistration(item.registration),
        event: mapEvent(item.event, undefined, currentUserId()),
      }));
    },
    async register(eventId, input, idempotencyKey) {
      const result = await protectedRequest<BackendRegistrationResult>({
        url: `/api/v1/events/${eventId}/registrations`, method: 'POST',
        header: { 'Idempotency-Key': idempotencyKey },
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
      await protectedRequest<BackendRegistrationResult>({ url: `/api/v1/events/${eventId}/registrations/me`, method: 'DELETE' });
    },
    async publish(input) {
      const roadbook = await transport<BackendRoadbook>({ url: `/api/v1/routes/${input.routeId}`, method: 'GET' });
      const route = mapRoadbook(roadbook);
      const draft = await protectedRequest<BackendEvent>({ url: '/api/v1/events', method: 'POST', data: toCreateEvent(input, route) });
      const published = await protectedRequest<BackendEvent>({ url: `/api/v1/events/${draft.id}/publish`, method: 'POST' });
      return mapEvent(published, route, currentUserId());
    },
    async updateEvent(id, input) {
      const roadbook = await transport<BackendRoadbook>({ url: `/api/v1/routes/${input.routeId}`, method: 'GET' });
      const route = mapRoadbook(roadbook);
      const updated = await protectedRequest<BackendEvent>({ url: `/api/v1/events/${id}`, method: 'PUT', data: toCreateEvent(input, route) });
      return mapEvent(updated, route, currentUserId());
    },
    async getProfile() {
      const result = await protectedRequest<{ profile: UserProfile | null }>({ url: '/api/v1/me/profile', method: 'GET' });
      return result.profile;
    },
    async updateProfile(profile) {
      const result = await protectedRequest<{ profile: UserProfile }>({ url: '/api/v1/me/profile', method: 'PUT', data: profile });
      if (typeof wx !== 'undefined') {
        const current = wx.getStorageSync('demo_account') || {};
        wx.setStorageSync('demo_account', { ...current, ...result.profile });
      }
      return result.profile;
    },
    async importGpx(filePath, fileName) {
      const result = await uploadGpx(filePath, fileName, await authHeaders());
      return mapRoadbook(result);
    },
  };
}

function uploadGpx(filePath: string, fileName = 'route.gpx', headers: Record<string, string>): Promise<BackendRoadbook> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}/api/v1/routes/import/gpx`, filePath, name: 'file', formData: { fileName }, header: headers,
      success(response) {
        try {
          const body = JSON.parse(response.data) as ApiEnvelope<BackendRoadbook>;
          if (response.statusCode >= 200 && response.statusCode < 300 && body.data) resolve(body.data);
          else reject(new ApiError('GPX 路书导入失败', response.statusCode, 'GPX_IMPORT_FAILED'));
        } catch { reject(new ApiError('GPX 路书响应格式错误', response.statusCode, 'GPX_IMPORT_FAILED')); }
      },
      fail: () => reject(new ApiError('GPX 文件上传失败', 0, 'GPX_UPLOAD_FAILED')),
    });
  });
}

function readFileAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(String(result.data)),
      fail: (error) => reject(new ApiError(`头像读取失败：${error.errMsg}`, 0, 'AVATAR_READ_FAILED')),
    });
  });
}

function uploadAvatarBase64(filePath: string, headers: Record<string, string>): Promise<{ profile: UserProfile }> {
  return readFileAsBase64(filePath).then((data) => new Promise((resolve, reject) => wx.request<ApiEnvelope<{ profile: UserProfile }>>({
    url: `${API_BASE_URL}/api/v1/me/avatar/base64`,
    method: 'POST',
    data: { data },
    header: { 'content-type': 'application/json', ...headers },
    success(response) {
      try {
        const body = typeof response.data === 'string' ? JSON.parse(response.data) as ApiEnvelope<{ profile: UserProfile }> : response.data;
        if (response.statusCode >= 200 && response.statusCode < 300 && body.data) resolve(body.data);
        else {
          const payload = body as unknown as { error?: { code?: string; message?: string } };
          reject(new ApiError(payload.error?.message || '头像上传失败', response.statusCode, payload.error?.code || 'AVATAR_UPLOAD_FAILED'));
        }
      } catch {
        reject(new ApiError('头像上传响应格式错误', response.statusCode, 'AVATAR_UPLOAD_FAILED'));
      }
    },
    fail: (error) => reject(new ApiError(`头像上传失败：${error.errMsg}`, 0, 'AVATAR_UPLOAD_FAILED')),
  })));
}

const realApi = createRealApi(
  wxTransport,
  () => wx.getStorageSync('demo_account')?.id || '',
  authenticationHeaders,
);

export const api: ClientApi = USE_MOCK ? {
  ...mockApi,
  login: async () => undefined,
  registerProfile: async (nickname) => ({ id: 'mock-user', nickname, avatarUrl: null, city: '' }),
  register: (eventId, input) => mockApi.register(eventId, input),
} : realApi;
