"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
App({
    onLaunch() {
        const account = wx.getStorageSync('demo_account');
        if (env_1.USE_MOCK && !account) {
            wx.setStorageSync('demo_account', { id: 'user-demo', nickname: '林峥', city: '北京' });
        }
    },
});
