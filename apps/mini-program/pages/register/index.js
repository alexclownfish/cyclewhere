"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
Page({
    data: {
        eventId: '', intentKey: '', event: null, loading: true, submitting: false, success: false, successCopy: '', dateText: '',
        bikeTypes: ['公路车', '砾石车', '山地车'], bikeIndex: 0,
        form: { phone: '', emergencyContact: '', bikeType: '公路车', abilityConfirmed: false, waiverConfirmed: false },
    },
    onLoad(options) {
        const eventId = options.eventId || '';
        this.setData({ eventId, intentKey: (0, domain_1.makeIdempotencyKey)(eventId) });
        this.loadEvent();
    },
    async loadEvent() {
        try {
            const event = await api_1.api.getEvent(this.data.eventId);
            this.setData({ event, dateText: (0, presentation_1.formatRideDate)(event.startAt), loading: false });
        }
        catch (error) {
            this.setData({ loading: false });
            wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
        }
    },
    onField(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
    chooseBike(event) {
        const bikeIndex = Number(event.detail.value);
        this.setData({ bikeIndex, 'form.bikeType': this.data.bikeTypes[bikeIndex] });
    },
    toggleConfirm(event) {
        const field = event.currentTarget.dataset.field;
        this.setData({ [`form.${field}`]: !this.data.form[field] });
    },
    async submit() {
        if (this.data.submitting)
            return;
        if (!wx.getStorageSync('auth_token')) {
            const result = await wx.showModal({ title: '请先登录', content: '授权微信头像和昵称后即完成注册，随后可继续报名。', confirmText: '去登录' });
            if (result.confirm)
                wx.switchTab({ url: '/pages/mine/index' });
            return;
        }
        const validation = (0, domain_1.validateRegistration)(this.data.form);
        if (!validation.valid)
            return wx.showToast({ title: validation.message, icon: 'none' });
        this.setData({ submitting: true });
        try {
            const registration = await api_1.api.register(this.data.eventId, this.data.form, this.data.intentKey);
            const successCopy = registration.status === 'pending'
                ? '报名已进入审核，组织者将在 24 小时内处理；结果会通过服务通知发送。'
                : '名额已确认，请按活动要求准备装备并留意出发前的活动变更。';
            this.setData({ success: true, successCopy });
        }
        catch (error) {
            wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
        }
        finally {
            this.setData({ submitting: false });
        }
    },
    goMine() { wx.switchTab({ url: '/pages/mine/index' }); },
});
