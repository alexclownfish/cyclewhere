"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
const RECENT_MEETING_POINTS_KEY = 'fengji_recent_meeting_points_v1';
const CHANGE_SUMMARY_LIMIT = 80;
let keyboardCloseTimer = null;
function comparableForm(form) {
    if (!form)
        return '';
    const { coverFilePath, ...persisted } = form;
    return JSON.stringify(persisted);
}
function dateParts(value) {
    const date = new Date(value);
    return {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    };
}
function optionState(labels, selected) {
    return labels.map((label) => ({ label, selected: selected.includes(label) }));
}
Page({
    data: {
        id: '', loading: true, loadError: '', submitting: false, keyboardOpen: false,
        event: null, routes: [],
        routeOptions: [{ name: '不选择路书', route: null }], selectedRoute: null, routeIndex: 0,
        difficultyOptions: ['轻松', '中等', '进阶'], difficultyIndex: 1,
        changeCount: 0, changeLimit: 3, changesRemaining: 3, isLastChange: false, changeLocked: false,
        changeSummary: '', summaryLength: 0, summaryLimit: CHANGE_SUMMARY_LIMIT,
        coverPreview: '',
        form: null, originalForm: '',
        equipmentOptions: [], bikeOptions: [], disciplineOptions: [],
    },
    onLoad(options) {
        const id = String(options.id || '');
        this.setData({ id });
        if (!id) {
            this.setData({ loading: false, loadError: '缺少活动信息，请返回重试' });
            return;
        }
        this.loadPage();
    },
    onUnload() {
        if (keyboardCloseTimer)
            clearTimeout(keyboardCloseTimer);
        keyboardCloseTimer = null;
    },
    async loadPage() {
        this.setData({ loading: true, loadError: '' });
        try {
            const [event, routes] = await Promise.all([api_1.api.getEvent(this.data.id), api_1.api.listRoutes()]);
            if (!event.ownedByMe)
                throw new Error('只有活动发布者可以修改活动');
            const start = dateParts(event.startAt);
            const routeIndex = routes.findIndex((route) => route.id === event.routeId);
            const selectedRoute = routeIndex >= 0 ? routes[routeIndex] : null;
            const changeCount = event.changeCount || 0;
            const changeLimit = event.changeLimit || 3;
            const changesRemaining = Math.max(0, changeLimit - changeCount);
            const form = {
                title: event.title, ...start, meetingPoint: event.meetingPoint,
                meetingLatitude: event.meetingLatitude ?? undefined, meetingLongitude: event.meetingLongitude ?? undefined,
                routeId: event.routeId, distanceKm: event.route.distanceKm, elevationGainM: event.route.elevationGainM,
                difficulty: event.route.difficulty, capacity: event.capacity, speedRange: event.speedRange,
                description: event.description, requirements: {
                    ...event.requirements, equipment: [...event.requirements.equipment], bikeTypes: [...event.requirements.bikeTypes], disciplines: [...event.requirements.disciplines],
                },
            };
            this.setData({
                event, routes, routeOptions: [{ name: '不选择路书', route: null }, ...routes.map((route) => ({ name: route.name, route }))],
                selectedRoute, routeIndex: routeIndex + 1, difficultyIndex: Math.max(0, this.data.difficultyOptions.indexOf(event.route.difficulty)),
                changeCount, changeLimit, changesRemaining, isLastChange: changesRemaining === 1, changeLocked: changesRemaining === 0,
                coverPreview: event.coverUrl || '', form, originalForm: comparableForm(form),
                equipmentOptions: optionState(['骑行头盔', '前后车灯', '补胎工具', '备用内胎', '锁鞋', '对讲设备'], event.requirements.equipment),
                bikeOptions: optionState(['公路车', '砾石车', '山地车', '铁三车'], event.requirements.bikeTypes),
                disciplineOptions: optionState(['听从领队指挥', '保持安全车距', '下坡禁止超车', '掉队原地等收队'], event.requirements.disciplines),
                loading: false,
            });
        }
        catch (error) {
            this.setData({ loading: false, loadError: (0, presentation_1.errorMessage)(error) });
        }
    },
    onField(event) {
        const field = String(event.currentTarget.dataset.field || '');
        this.setData({ [`form.${field}`]: event.detail.value });
        if (field === 'meetingPoint')
            this.setData({ 'form.meetingLatitude': undefined, 'form.meetingLongitude': undefined });
    },
    onNumber(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: Number(event.detail.value) }); },
    onDate(event) { this.setData({ 'form.date': event.detail.value }); },
    onTime(event) { this.setData({ 'form.time': event.detail.value }); },
    onRoute(event) {
        const routeIndex = Number(event.detail.value);
        const selectedRoute = this.data.routeOptions[routeIndex]?.route || null;
        this.setData({ routeIndex, selectedRoute, 'form.routeId': selectedRoute?.id || '', 'form.distanceKm': selectedRoute?.distanceKm || 0, 'form.elevationGainM': selectedRoute?.elevationGainM || 0, 'form.difficulty': selectedRoute?.difficulty || '中等', difficultyIndex: selectedRoute ? Math.max(0, this.data.difficultyOptions.indexOf(selectedRoute.difficulty)) : 1 });
    },
    onDifficulty(event) {
        const difficultyIndex = Number(event.detail.value);
        this.setData({ difficultyIndex, 'form.difficulty': this.data.difficultyOptions[difficultyIndex] });
    },
    onSummary(event) {
        const changeSummary = String(event.detail.value || '');
        this.setData({ changeSummary, summaryLength: Array.from(changeSummary).length });
    },
    chooseMeetingPointOnMap() {
        wx.chooseLocation({
            success: (result) => {
                const label = result.name || result.address;
                if (!label)
                    return;
                const recent = (wx.getStorageSync(RECENT_MEETING_POINTS_KEY) || []);
                wx.setStorageSync(RECENT_MEETING_POINTS_KEY, [label, ...recent.filter((item) => item !== label)].slice(0, 8));
                this.setData({ 'form.meetingPoint': label, 'form.meetingLatitude': result.latitude, 'form.meetingLongitude': result.longitude });
            },
            fail: () => undefined,
        });
    },
    chooseCover() {
        if (this.data.changeLocked)
            return;
        wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: (result) => {
                const filePath = result.tempFilePaths[0];
                if (filePath)
                    this.setData({ coverPreview: filePath, 'form.coverFilePath': filePath });
            }, fail: () => undefined });
    },
    toggleOption(event) {
        if (this.data.changeLocked)
            return;
        const group = event.currentTarget.dataset.group;
        const index = Number(event.currentTarget.dataset.index);
        this.setData({ [group]: this.data[group].map((item, itemIndex) => itemIndex === index ? { ...item, selected: !item.selected } : item) }, () => this.syncRequirements());
    },
    syncRequirements() {
        this.setData({
            'form.requirements.equipment': this.data.equipmentOptions.filter((item) => item.selected).map((item) => item.label),
            'form.requirements.bikeTypes': this.data.bikeOptions.filter((item) => item.selected).map((item) => item.label),
            'form.requirements.disciplines': this.data.disciplineOptions.filter((item) => item.selected).map((item) => item.label),
        });
    },
    onKeyboardOpen() {
        if (keyboardCloseTimer)
            clearTimeout(keyboardCloseTimer);
        keyboardCloseTimer = null;
        if (!this.data.keyboardOpen)
            this.setData({ keyboardOpen: true });
    },
    onKeyboardClose() {
        if (keyboardCloseTimer)
            clearTimeout(keyboardCloseTimer);
        keyboardCloseTimer = setTimeout(() => { this.setData({ keyboardOpen: false }); keyboardCloseTimer = null; }, 120);
    },
    async submit() {
        if (this.data.submitting || this.data.changeLocked || !this.data.form)
            return;
        const changeSummary = this.data.changeSummary.trim();
        const summaryLength = Array.from(changeSummary).length;
        if (!changeSummary)
            return wx.showToast({ title: '请填写本次变更摘要', icon: 'none' });
        if (summaryLength > CHANGE_SUMMARY_LIMIT)
            return wx.showToast({ title: '变更摘要不能超过 80 字', icon: 'none' });
        this.syncRequirements();
        if (comparableForm(this.data.form) === this.data.originalForm && !this.data.form.coverFilePath)
            return wx.showToast({ title: '活动信息没有发生变化', icon: 'none' });
        const validation = (0, domain_1.validatePublish)(this.data.form);
        if (!validation.valid)
            return wx.showToast({ title: validation.message, icon: 'none' });
        this.setData({ submitting: true });
        try {
            await api_1.api.updateEvent(this.data.id, { ...this.data.form, changeSummary });
            wx.showToast({ title: '修改已同步给参与者', icon: 'success' });
            setTimeout(() => wx.redirectTo({ url: `/pages/event-detail/index?id=${encodeURIComponent(this.data.id)}` }), 450);
        }
        catch (error) {
            const message = (0, presentation_1.errorMessage)(error);
            const code = error instanceof api_1.ApiError ? error.code : '';
            const concurrent = code === 'EVENT_CHANGE_LIMIT_REACHED';
            const conflict = code === 'EVENT_VERSION_CONFLICT';
            wx.showToast({ title: concurrent ? '修改次数已用完，请返回查看' : conflict ? '活动已被更新，请刷新后重试' : message, icon: 'none', duration: 3500 });
            if (concurrent || conflict)
                await this.loadPage();
        }
        finally {
            this.setData({ submitting: false });
        }
    },
});
