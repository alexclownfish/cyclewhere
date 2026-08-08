import { api } from '../../services/api';
import type { RegistrationStatus, RideEvent } from '../../types/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';

interface MyEventView extends RideEvent { dateText: string; statusText: string; statusTone: string; }

const statusMap: Record<RegistrationStatus, { text: string; tone: string }> = {
  pending: { text: '待审核', tone: 'badge-amber' },
  approved: { text: '已报名', tone: 'badge-green' },
  rejected: { text: '未通过', tone: 'badge-red' },
  cancelled: { text: '已取消', tone: '' },
};

function friendlyAuthError(error: unknown): string {
  const message = errorMessage(error);
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
    authChecking: true,
    authReady: false,
    authRequired: false,
    authError: '',
    authErrorCopy: '',
    profileEditing: false,
    account: null as { id: string; nickname?: string | null; city?: string | null; avatarUrl?: string | null; phoneMasked?: string | null } | null,
    avatarText: '骑',
    pendingAvatarUrl: '',
    pendingNickname: '',
    registered: [] as MyEventView[],
    published: [] as MyEventView[],
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
      await api.login();
      const account = wx.getStorageSync('demo_account') || { id: '', nickname: '微信骑友', city: '' };
      const profile = await api.getProfile();
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
    } catch (error) {
      this.setData({
        authChecking: false,
        authReady: false,
        loading: false,
        authError: errorMessage(error),
        authErrorCopy: friendlyAuthError(error),
      });
    }
  },
  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ pendingAvatarUrl: event.detail.avatarUrl, authError: '', authErrorCopy: '' });
  },
  onNickname(event: WechatMiniprogram.Input) {
    this.setData({ pendingNickname: event.detail.value, authError: '', authErrorCopy: '' });
  },
  async completeRegistration() {
    const nickname = this.data.pendingNickname.trim();
    if (!this.data.pendingAvatarUrl) return wx.showToast({ title: '请先选择微信头像', icon: 'none' });
    if (!nickname) return wx.showToast({ title: '请选择或填写微信昵称', icon: 'none' });
    this.setData({ authChecking: true, authRequired: false, authError: '', authErrorCopy: '', error: '' });
    try {
      const profile = await api.registerProfile(nickname, this.data.pendingAvatarUrl, !wx.getStorageSync('auth_token'));
      this.setData({
        authChecking: false,
        authReady: true,
        authRequired: false,
        profileEditing: false,
        account: profile,
        avatarText: profile.nickname?.slice(0, 1) || '骑',
      });
      await this.loadMine();
    } catch (error) {
      this.setData({
        authChecking: false,
        authReady: false,
        authRequired: true,
        authError: errorMessage(error),
        authErrorCopy: friendlyAuthError(error),
      });
    }
  },
  async wechatOneTapLogin() {
    if (this.data.authChecking) return;
    this.setData({ authChecking: true, authRequired: false, authError: '', authErrorCopy: '' });
    try {
      await api.login(true);
      await this.checkLogin();
    } catch (error) {
      this.setData({ authChecking: false, authRequired: true, authError: errorMessage(error), authErrorCopy: friendlyAuthError(error) });
    }
  },
  async phoneLogin(event: WechatMiniprogram.CustomEvent<{ code?: string }>) {
    const code = event.detail.code;
    if (!code) return this.setData({ authError: 'PHONE_AUTH_CANCELLED', authErrorCopy: '未完成手机号授权，可使用微信一键登录。' });
    this.setData({ authChecking: true, authRequired: false, authError: '', authErrorCopy: '' });
    try {
      await api.phoneLogin(code);
      await this.checkLogin();
    } catch (error) {
      this.setData({ authChecking: false, authRequired: true, authError: errorMessage(error), authErrorCopy: friendlyAuthError(error) });
    }
  },
  async bindPhone(event: WechatMiniprogram.CustomEvent<{ code?: string }>) {
    const code = event.detail.code;
    if (!code) return;
    try {
      const profile = await api.bindPhone(code);
      const account = { ...(this.data.account || { id: profile.id }), ...profile };
      this.setData({ account });
      wx.showToast({ title: '手机号已绑定', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' });
    }
  },
  retryAuth() { this.checkLogin(); },
  async loadMine() {
    if (!this.data.authReady) return;
    this.setData({ loading: true, error: '' });
    try {
      const [events, records] = await Promise.all([api.listEvents(), api.getMyRegistrationRecords()]);
      const registered = records.map(({ registration, event }) => {
        const status = statusMap[registration.status];
        return { ...event, dateText: formatRideDate(event.startAt), statusText: status.text, statusTone: status.tone };
      }) as MyEventView[];
      const published = events
        .filter((item) => item.ownedByMe)
        .map((item) => ({ ...item, dateText: formatRideDate(item.startAt), statusText: '已发布', statusTone: 'badge-green' }));
      this.setData({ registered, published, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) });
    }
  },
  switchSegment(event: WechatMiniprogram.TouchEvent) { this.setData({ active: event.currentTarget.dataset.value }); },
  openEvent(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/event-detail/index?id=${event.currentTarget.dataset.id}` }); },
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
  editEvent(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/publish/index?id=${event.currentTarget.dataset.id}` }); },
});
