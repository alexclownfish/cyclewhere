import { api } from '../../services/api';
import { errorMessage } from '../../utils/presentation';

Page({
  data: {
    loading: false,
    error: '',
  },
  async onShow() {
    if (!wx.getStorageSync('auth_token')) return;
    this.setData({ loading: true, error: '' });
    try {
      await api.getProfile();
      this.enterApp();
    } catch {
      wx.removeStorageSync('auth_token');
      this.setData({ loading: false });
    }
  },
  async wechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await api.login(true);
      this.enterApp();
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) });
    }
  },
  async phoneLogin(event: WechatMiniprogram.CustomEvent<{ code?: string; errMsg?: string }>) {
    if (this.data.loading) return;
    const code = event.detail.code;
    if (!code) {
      this.setData({ error: '未完成手机号授权，可使用微信一键登录' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await api.phoneLogin(code);
      this.enterApp();
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) });
    }
  },
  enterApp() {
    wx.switchTab({ url: '/pages/events/index' });
  },
});
