"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let readyTimer = null;
Page({
    data: { ready: false },
    onLoad() {
        readyTimer = setTimeout(() => {
            this.setData({ ready: true });
            readyTimer = null;
        }, 1650);
    },
    onUnload() {
        if (readyTimer)
            clearTimeout(readyTimer);
        readyTimer = null;
    },
    joinActivity() {
        if (!this.data.ready)
            return;
        wx.switchTab({ url: '/pages/events/index' });
    },
    publishActivity() {
        if (!this.data.ready)
            return;
        wx.switchTab({ url: '/pages/publish/index' });
    },
});
