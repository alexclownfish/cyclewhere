"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = exports.ApiError = void 0;
exports.normalizeRequestSpec = normalizeRequestSpec;
exports.createAuthenticationProvider = createAuthenticationProvider;
exports.createRealApi = createRealApi;
const env_1 = require("../config/env");
const mock_api_1 = require("./mock-api");
const api_contract_1 = require("./api-contract");
function normalizeRequestSpec(spec) {
    return ['POST', 'PUT'].includes(spec.method) && spec.data === undefined ? { ...spec, data: {} } : spec;
}
class ApiError extends Error {
    constructor(message, statusCode, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'ApiError';
    }
}
exports.ApiError = ApiError;
function wxTransport(spec) {
    return new Promise((resolve, reject) => {
        const requestSpec = normalizeRequestSpec(spec);
        wx.request({
            ...requestSpec,
            url: `${env_1.API_BASE_URL}${spec.url}`,
            header: { 'content-type': 'application/json', ...spec.header },
            success(response) {
                if (response.statusCode >= 200 && response.statusCode < 300)
                    resolve(response.data.data);
                else {
                    const payload = response.data;
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
function wechatLogin() {
    return new Promise((resolve, reject) => wx.login({
        success: ({ code }) => code ? resolve(code) : reject(new Error('微信登录失败')),
        fail: (error) => reject(new ApiError(`微信登录失败：${error.errMsg}`, 0, 'WX_LOGIN_FAILED')),
    }));
}
async function authenticationHeaders(forceRefresh = false) {
    return realAuthenticationHeaders(forceRefresh);
}
function createAuthenticationProvider(transport, getLoginCode, storage) {
    let pending = null;
    return async (forceRefresh = false) => {
        if (forceRefresh)
            storage.remove?.('auth_token');
        const storedToken = storage.get('auth_token');
        if (typeof storedToken === 'string' && storedToken)
            return { Authorization: `Bearer ${storedToken}` };
        if (!pending)
            pending = (async () => {
                const result = await transport({
                    url: '/api/v1/auth/wechat/login', method: 'POST', data: { code: await getLoginCode() },
                });
                storage.set('auth_token', result.accessToken);
                storage.set('demo_account', result.user.profile
                    ? { ...result.user.profile, id: result.user.id }
                    : { id: result.user.id, nickname: '微信骑友', city: '' });
                return { Authorization: `Bearer ${result.accessToken}` };
            })();
        try {
            return await pending;
        }
        finally {
            pending = null;
        }
    };
}
const realAuthenticationHeaders = typeof wx === 'undefined'
    ? async () => ({})
    : createAuthenticationProvider(wxTransport, wechatLogin, {
        get: (key) => wx.getStorageSync(key),
        set: (key, value) => wx.setStorageSync(key, value),
        remove: (key) => wx.removeStorageSync(key),
    });
function createRealApi(transport, currentUser, authHeaders) {
    const currentUserId = () => typeof currentUser === 'function' ? currentUser() : currentUser;
    async function protectedRequest(spec) {
        try {
            return await transport({ ...spec, header: { ...spec.header, ...(await authHeaders()) } });
        }
        catch (error) {
            if (!(error instanceof ApiError) || error.statusCode !== 401)
                throw error;
            return transport({ ...spec, header: { ...spec.header, ...(await authHeaders(true)) } });
        }
    }
    async function loadAllPages(url) {
        const items = [];
        let cursor = null;
        do {
            const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
            const page = await transport({ url: `${url}${suffix}`, method: 'GET' });
            items.push(...page.items);
            cursor = page.nextCursor;
        } while (cursor);
        return items;
    }
    const loadRoadbooks = () => loadAllPages('/api/v1/routes?limit=100');
    const loadEvents = () => loadAllPages('/api/v1/events?limit=100');
    return {
        async login(forceRefresh = false) {
            await authHeaders(forceRefresh);
        },
        async phoneLogin(phoneCode) {
            if (typeof wx === 'undefined')
                throw new ApiError('微信环境不可用', 0, 'WX_UNAVAILABLE');
            const result = await transport({
                url: '/api/v1/auth/wechat/phone-login', method: 'POST',
                data: { loginCode: await wechatLogin(), phoneCode },
            });
            wx.setStorageSync('auth_token', result.accessToken);
            wx.setStorageSync('demo_account', result.user.profile
                ? { ...result.user.profile, id: result.user.id }
                : { id: result.user.id, nickname: '微信骑友', city: '' });
        },
        async bindPhone(phoneCode) {
            const result = await protectedRequest({
                url: '/api/v1/me/phone', method: 'POST', data: { code: phoneCode },
            });
            if (typeof wx !== 'undefined') {
                const current = wx.getStorageSync('demo_account') || {};
                wx.setStorageSync('demo_account', { ...current, ...result.profile });
            }
            return result.profile;
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
            }
            catch (error) {
                if (error instanceof ApiError && error.statusCode === 404) {
                    throw new ApiError('服务器尚未升级用户资料接口，请先部署最新后端', 503, 'PROFILE_ENDPOINT_MISSING');
                }
                throw error;
            }
        },
        async listEvents() {
            const [events, roadbooks] = await Promise.all([loadEvents(), loadRoadbooks()]);
            const routeById = new Map(roadbooks.map((item) => [item.id, (0, api_contract_1.mapRoadbook)(item)]));
            return events.map((item) => (0, api_contract_1.mapEvent)(item, item.routeId ? routeById.get(item.routeId) : undefined, currentUserId()));
        },
        async getEvent(id) {
            const event = await transport({ url: `/api/v1/events/${id}`, method: 'GET' });
            const route = event.routeId
                ? (0, api_contract_1.mapRoadbook)(await transport({ url: `/api/v1/routes/${event.routeId}`, method: 'GET' }))
                : undefined;
            return (0, api_contract_1.mapEvent)(event, route, currentUserId());
        },
        async listRoutes() {
            return (await loadRoadbooks()).map(api_contract_1.mapRoadbook);
        },
        async getRoute(id) {
            return (0, api_contract_1.mapRoadbook)(await transport({ url: `/api/v1/routes/${id}`, method: 'GET' }));
        },
        async getRegistrationStatus(eventId) {
            const status = await protectedRequest({
                url: `/api/v1/events/${eventId}/registration-status`, method: 'GET',
            });
            return status ? (0, api_contract_1.mapRegistration)(status) : null;
        },
        async getMyRegistrationRecords() {
            const result = await protectedRequest({
                url: '/api/v1/me/registrations', method: 'GET',
            });
            return result.items.map((item) => ({
                registration: (0, api_contract_1.mapRegistration)(item.registration),
                event: (0, api_contract_1.mapEvent)(item.event, undefined, currentUserId()),
            }));
        },
        async register(eventId, input, idempotencyKey) {
            const result = await protectedRequest({
                url: `/api/v1/events/${eventId}/registrations`, method: 'POST',
                header: { 'Idempotency-Key': idempotencyKey },
                data: {
                    phone: input.phone,
                    emergencyContact: input.emergencyContact,
                    bikeType: input.bikeType,
                    abilityConfirmed: input.abilityConfirmed,
                    equipmentConfirmed: input.abilityConfirmed,
                    waiverVersion: env_1.WAIVER_VERSION,
                },
            });
            return (0, api_contract_1.mapRegistration)(result.registration);
        },
        async cancelRegistration(eventId) {
            await protectedRequest({ url: `/api/v1/events/${eventId}/registrations/me`, method: 'DELETE' });
        },
        async publish(input) {
            const roadbook = await transport({ url: `/api/v1/routes/${input.routeId}`, method: 'GET' });
            const route = (0, api_contract_1.mapRoadbook)(roadbook);
            const draft = await protectedRequest({ url: '/api/v1/events', method: 'POST', data: (0, api_contract_1.toCreateEvent)(input, route) });
            if (input.coverFilePath)
                await uploadEventCover(draft.id, input.coverFilePath, await authHeaders());
            const published = await protectedRequest({ url: `/api/v1/events/${draft.id}/publish`, method: 'POST' });
            return (0, api_contract_1.mapEvent)(published, route, currentUserId());
        },
        async updateEvent(id, input) {
            const roadbook = await transport({ url: `/api/v1/routes/${input.routeId}`, method: 'GET' });
            const route = (0, api_contract_1.mapRoadbook)(roadbook);
            let updated = await protectedRequest({ url: `/api/v1/events/${id}`, method: 'PUT', data: (0, api_contract_1.toCreateEvent)(input, route) });
            if (input.coverFilePath)
                updated = await uploadEventCover(id, input.coverFilePath, await authHeaders());
            return (0, api_contract_1.mapEvent)(updated, route, currentUserId());
        },
        async getProfile() {
            const result = await protectedRequest({ url: '/api/v1/me/profile', method: 'GET' });
            return result.profile;
        },
        async updateProfile(profile) {
            const result = await protectedRequest({ url: '/api/v1/me/profile', method: 'PUT', data: profile });
            if (typeof wx !== 'undefined') {
                const current = wx.getStorageSync('demo_account') || {};
                wx.setStorageSync('demo_account', { ...current, ...result.profile });
            }
            return result.profile;
        },
        async importGpx(filePath, fileName) {
            const result = await uploadGpx(filePath, fileName, await authHeaders());
            return (0, api_contract_1.mapRoadbook)(result);
        },
    };
}
function readFileText(filePath) {
    return new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
            filePath,
            encoding: 'utf8',
            success: ({ data }) => typeof data === 'string' && data
                ? resolve(data)
                : reject(new ApiError('GPX 文件读取失败', 0, 'GPX_READ_FAILED')),
            fail: (error) => reject(new ApiError(`GPX 文件读取失败：${error.errMsg}`, 0, 'GPX_READ_FAILED')),
        });
    });
}
function uploadGpx(filePath, fileName = 'route.gpx', headers) {
    return readFileText(filePath).then((gpx) => new Promise((resolve, reject) => wx.request({
        url: `${env_1.API_BASE_URL}/api/v1/routes/import/gpx`, method: 'POST',
        data: { gpx, name: fileName.replace(/\.gpx$/i, '') },
        header: { 'content-type': 'application/json', ...headers },
        success(response) {
            try {
                const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                if (response.statusCode >= 200 && response.statusCode < 300 && body.data)
                    resolve(body.data);
                else {
                    const payload = body;
                    reject(new ApiError(payload.error?.message || 'GPX 路书导入失败', response.statusCode, payload.error?.code || 'GPX_IMPORT_FAILED'));
                }
            }
            catch {
                reject(new ApiError('GPX 路书响应格式错误', response.statusCode, 'GPX_IMPORT_FAILED'));
            }
        },
        fail: (error) => reject(new ApiError(`GPX 上传失败：${error.errMsg}`, 0, 'GPX_UPLOAD_FAILED')),
    })));
}
function readFileAsBase64(filePath) {
    return new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
            filePath,
            encoding: 'base64',
            success: (result) => resolve(String(result.data)),
            fail: (error) => reject(new ApiError(`头像读取失败：${error.errMsg}`, 0, 'AVATAR_READ_FAILED')),
        });
    });
}
function uploadAvatarBase64(filePath, headers) {
    return readFileAsBase64(filePath).then((data) => new Promise((resolve, reject) => wx.request({
        url: `${env_1.API_BASE_URL}/api/v1/me/avatar/base64`,
        method: 'POST',
        data: { data },
        header: { 'content-type': 'application/json', ...headers },
        success(response) {
            try {
                const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                if (response.statusCode >= 200 && response.statusCode < 300 && body.data)
                    resolve(body.data);
                else {
                    const payload = body;
                    reject(new ApiError(payload.error?.message || '头像上传失败', response.statusCode, payload.error?.code || 'AVATAR_UPLOAD_FAILED'));
                }
            }
            catch {
                reject(new ApiError('头像上传响应格式错误', response.statusCode, 'AVATAR_UPLOAD_FAILED'));
            }
        },
        fail: (error) => reject(new ApiError(`头像上传失败：${error.errMsg}`, 0, 'AVATAR_UPLOAD_FAILED')),
    })));
}
function uploadEventCover(eventId, filePath, headers) {
    return readFileAsBase64(filePath).then((data) => new Promise((resolve, reject) => wx.request({
        url: `${env_1.API_BASE_URL}/api/v1/events/${eventId}/cover/base64`, method: 'POST', data: { data },
        header: { 'content-type': 'application/json', ...headers },
        success(response) {
            try {
                const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                if (response.statusCode >= 200 && response.statusCode < 300 && body.data)
                    resolve(body.data);
                else {
                    const payload = body;
                    reject(new ApiError(payload.error?.message || '活动封面上传失败', response.statusCode, payload.error?.code || 'COVER_UPLOAD_FAILED'));
                }
            }
            catch {
                reject(new ApiError('活动封面响应格式错误', response.statusCode, 'COVER_UPLOAD_FAILED'));
            }
        },
        fail: (error) => reject(new ApiError(`活动封面上传失败：${error.errMsg}`, 0, 'COVER_UPLOAD_FAILED')),
    })));
}
const realApi = createRealApi(wxTransport, () => wx.getStorageSync('demo_account')?.id || '', authenticationHeaders);
exports.api = env_1.USE_MOCK ? {
    ...mock_api_1.mockApi,
    login: async () => undefined,
    phoneLogin: async () => undefined,
    bindPhone: async () => ({ id: 'mock-user', nickname: '微信骑友', avatarUrl: null, phoneMasked: '138****8000', city: '' }),
    registerProfile: async (nickname) => ({ id: 'mock-user', nickname, avatarUrl: null, city: '' }),
    register: (eventId, input) => mock_api_1.mockApi.register(eventId, input),
} : realApi;
