import { api } from '../../services/api';
import { errorMessage } from '../../utils/presentation';

type Intent = 'events' | 'mine' | 'publish' | 'register';

function validIntent(value: string): Intent {
  return value === 'mine' || value === 'publish' || value === 'register' ? value : 'events';
}

Page({
  data: {
    stage: 'consent' as 'consent' | 'profile',
    loading: false,
    error: '',
    pendingAvatarUrl: '',
    pendingNickname: '',
    intent: 'events' as Intent,
    eventId: '',
  },
  onLoad(options: Record<string, string>) {
    this.setData({ intent: validIntent(options.intent || ''), eventId: options.eventId || '' });
  },
  async onShow() {
    if (!wx.getStorageSync('auth_token') || this.data.stage !== 'consent') return;
    try {
      const profile = await api.getProfile();
      if (profile) this.finish();
    } catch {
      // An expired token is handled by the consent action, which creates a fresh session.
    }
  },
  browse() {
    wx.switchTab({ url: '/pages/events/index' });
  },
  async agree() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      wx.setStorageSync('privacy_policy_accepted_v1', true);
      await api.login(true);
      const profile = await api.getProfile();
      if (profile) {
        this.finish();
        return;
      }
      this.setData({ loading: false, stage: 'profile' });
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) || '暂时无法完成微信登录，请稍后再试。' });
    }
  },
  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ pendingAvatarUrl: event.detail.avatarUrl, error: '' });
  },
  onNickname(event: WechatMiniprogram.Input) {
    this.setData({ pendingNickname: event.detail.value, error: '' });
  },
  async completeProfile() {
    const nickname = this.data.pendingNickname.trim();
    if (!this.data.pendingAvatarUrl) {
      this.setData({ error: '请选择微信头像后继续。' });
      return;
    }
    if (!nickname) {
      this.setData({ error: '请选择或填写微信昵称后继续。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await api.registerProfile(nickname, this.data.pendingAvatarUrl);
      this.finish();
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) || '资料保存失败，请稍后再试。' });
    }
  },
  backToConsent() {
    this.setData({ stage: 'consent', error: '' });
  },
  finish() {
    const { intent, eventId } = this.data;
    if (intent === 'publish' || intent === 'mine') {
      wx.switchTab({ url: intent === 'publish' ? '/pages/publish/index' : '/pages/mine/index' });
      return;
    }
    if (intent === 'register' && eventId) {
      wx.redirectTo({ url: `/pages/register/index?eventId=${encodeURIComponent(eventId)}` });
      return;
    }
    wx.switchTab({ url: '/pages/events/index' });
  },
});
