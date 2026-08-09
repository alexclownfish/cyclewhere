"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const presentation_1 = require("../../utils/presentation");
const statusMap = {
    pending: { text: '待审核', tone: 'badge-amber' },
    approved: { text: '已报名', tone: 'badge-green' },
    rejected: { text: '未通过', tone: 'badge-red' },
    cancelled: { text: '已取消', tone: '' },
};
function friendlyAuthError(error) {
    const message = (0, presentation_1.errorMessage)(error);
    if (/url not in domain list/i.test(message)) {
        return '头像上传服务暂不可用，请稍后重试。如持续失败，请联系管理员检查小程序上传域名配置。';
    }
    if (/timeout|timed out|network|request:fail/i.test(message)) {
        return '网络连接不稳定，请检查网络后重新尝试。';
    }
    if (/401|unauthorized|登录失效|未登录/i.test(message)) {
        return '微信登录状态已失效，请重新尝试登录。';
    }
    return message || '暂时无法完成微信登录，请稍后重新尝试。';
}
Page({
    data: {
        active: 'registered',
        loading: false,
        error: '',
        registeredError: '',
        publishedError: '',
        authChecking: true,
        authReady: false,
        authRequired: false,
        authError: '',
        authErrorCopy: '',
        profileEditing: false,
        account: null,
        avatarText: '骑',
        pendingAvatarUrl: '',
        pendingNickname: '',
        registered: [],
        published: [],
    },
    onShow() { this.checkLogin(); },
    async checkLogin() {
        if (!wx.getStorageSync('auth_token')) {
            this.setData({
                authChecking: false,
                authReady: false,
                authRequired: true,
                authError: '',
                authErrorCopy: '',
                account: null,
            });
            return;
        }
        this.setData({ authChecking: true, authRequired: false, authError: '', authErrorCopy: '', error: '' });
        try {
            await api_1.api.login();
            const account = wx.getStorageSync('demo_account') || { id: '', nickname: '微信骑友', city: '' };
            const profile = await api_1.api.getProfile();
            if (!profile) {
                this.setData({ authChecking: false, authReady: false, authRequired: true, account: null });
                return;
            }
            const merged = { ...account, ...profile };
            wx.setStorageSync('demo_account', merged);
            this.setData({
                authChecking: false,
                authReady: true,
                authRequired: false,
                account: merged,
                avatarText: merged.nickname?.slice(0, 1) || '骑',
            });
            await this.loadMine();
        }
        catch (error) {
            this.setData({
                authChecking: false,
                authReady: false,
                loading: false,
                authError: (0, presentation_1.errorMessage)(error),
                authErrorCopy: friendlyAuthError(error),
            });
        }
    },
    chooseAvatar(event) {
        this.setData({ pendingAvatarUrl: event.detail.avatarUrl, authError: '', authErrorCopy: '' });
    },
    onNickname(event) {
        this.setData({ pendingNickname: event.detail.value, authError: '', authErrorCopy: '' });
    },
    async completeRegistration() {
        const nickname = this.data.pendingNickname.trim();
        if (!this.data.pendingAvatarUrl)
            return wx.showToast({ title: '请先选择微信头像', icon: 'none' });
        if (!nickname)
            return wx.showToast({ title: '请选择或填写微信昵称', icon: 'none' });
        this.setData({ authChecking: true, authRequired: false, authError: '', authErrorCopy: '', error: '' });
        try {
            const profile = await api_1.api.registerProfile(nickname, this.data.pendingAvatarUrl, !wx.getStorageSync('auth_token'));
            this.setData({
                authChecking: false,
                authReady: true,
                authRequired: false,
                profileEditing: false,
                account: profile,
                avatarText: profile.nickname?.slice(0, 1) || '骑',
            });
            await this.loadMine();
        }
        catch (error) {
            this.setData({
                authChecking: false,
                authReady: false,
                authRequired: true,
                authError: (0, presentation_1.errorMessage)(error),
                authErrorCopy: friendlyAuthError(error),
            });
        }
    },
    async wechatOneTapLogin() {
        wx.navigateTo({ url: '/pages/privacy/index?intent=mine' });
    },
    async phoneLogin(event) {
        wx.navigateTo({ url: '/pages/privacy/index?intent=mine' });
    },
    async bindPhone(event) {
        const code = event.detail.code;
        if (!code)
            return;
        try {
            const profile = await api_1.api.bindPhone(code);
            const account = { ...(this.data.account || { id: profile.id }), ...profile };
            this.setData({ account });
            wx.showToast({ title: '手机号已绑定', icon: 'success' });
        }
        catch (error) {
            wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
        }
    },
    retryAuth() { this.checkLogin(); },
    async loadMine() {
        if (!this.data.authReady)
            return;
        this.setData({ loading: true, error: '', registeredError: '', publishedError: '' });
        const [eventsResult, recordsResult] = await Promise.allSettled([api_1.api.listEvents(), api_1.api.getMyRegistrationRecords()]);
        const registered = recordsResult.status === 'fulfilled'
            ? recordsResult.value.map(({ registration, event }) => {
                const status = statusMap[registration.status];
                return { ...event, dateText: (0, presentation_1.formatRideDate)(event.startAt), statusText: status.text, statusTone: status.tone };
            })
            : [];
        const published = eventsResult.status === 'fulfilled'
            ? eventsResult.value
                .filter((item) => item.ownedByMe)
                .map((item) => ({ ...item, dateText: (0, presentation_1.formatRideDate)(item.startAt), statusText: '已发布', statusTone: 'badge-green' }))
            : [];
        const registeredError = recordsResult.status === 'rejected' ? (0, presentation_1.errorMessage)(recordsResult.reason) : '';
        const publishedError = eventsResult.status === 'rejected' ? (0, presentation_1.errorMessage)(eventsResult.reason) : '';
        this.setData({ registered, published, registeredError, publishedError, loading: false, error: this.data.active === 'registered' ? registeredError : publishedError });
    },
    switchSegment(event) {
        const active = event.currentTarget.dataset.value;
        this.setData({ active, error: active === 'registered' ? this.data.registeredError : this.data.publishedError });
    },
    openEvent(event) { wx.navigateTo({ url: `/pages/event-detail/index?id=${event.currentTarget.dataset.id}` }); },
    goExplore() { wx.switchTab({ url: '/pages/events/index' }); },
    goPublish() { wx.switchTab({ url: '/pages/publish/index' }); },
    editProfile() {
        this.setData({
            profileEditing: true,
            pendingAvatarUrl: '',
            pendingNickname: this.data.account?.nickname || '',
            authError: '',
            authErrorCopy: '',
        });
    },
    cancelEditProfile() { this.setData({ profileEditing: false }); },
    editEvent(event) {
        const id = String(event.currentTarget.dataset.id || '');
        if (!id)
            return wx.showToast({ title: '活动信息暂不可用', icon: 'none' });
        wx.setStorageSync('pending_edit_event_id', id);
        wx.switchTab({ url: '/pages/publish/index' });
    },
});
