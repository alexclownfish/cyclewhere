"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const presentation_1 = require("../../utils/presentation");
Page({
    data: {
        loading: false,
        error: '',
    },
    async onShow() {
        if (!wx.getStorageSync('auth_token'))
            return;
        this.setData({ loading: true, error: '' });
        try {
            await api_1.api.getProfile();
            this.enterApp();
        }
        catch {
            wx.removeStorageSync('auth_token');
            this.setData({ loading: false });
        }
    },
    async wechatLogin() {
        if (this.data.loading)
            return;
        this.setData({ loading: true, error: '' });
        try {
            await api_1.api.login(true);
            this.enterApp();
        }
        catch (error) {
            this.setData({ loading: false, error: (0, presentation_1.errorMessage)(error) });
        }
    },
    async phoneLogin(event) {
        if (this.data.loading)
            return;
        const code = event.detail.code;
        if (!code) {
            this.setData({ error: '未完成手机号授权，可使用微信一键登录' });
            return;
        }
        this.setData({ loading: true, error: '' });
        try {
            await api_1.api.phoneLogin(code);
            this.enterApp();
        }
        catch (error) {
            this.setData({ loading: false, error: (0, presentation_1.errorMessage)(error) });
        }
    },
    enterApp() {
        wx.switchTab({ url: '/pages/events/index' });
    },
});
