import { USE_MOCK } from './config/env';

App({
  onLaunch() {
    const account = wx.getStorageSync('demo_account');
    if (USE_MOCK && !account) {
      wx.setStorageSync('demo_account', { id: 'user-demo', nickname: '林峥', city: '北京' });
    }
  },
});
