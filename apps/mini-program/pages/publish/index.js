"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
const apple_modal_1 = require("../../utils/apple-modal");
const RECENT_MEETING_POINTS_KEY = 'fengji_recent_meeting_points_v1';
let keyboardCloseTimer = null;
Page({
    data: {
        routes: [], routeOptions: [{ name: '不选择路书', route: null }], selectedRoute: null, routeIndex: 0, submitting: false, importingGpx: false, keyboardOpen: false,
        locationSuggestions: [], showLocationSuggestions: false,
        difficultyOptions: ['轻松', '中等', '进阶'], difficultyIndex: 1,
        coverPreview: '',
        appleModal: { visible: false, title: '', content: '', showCancel: true, cancelText: '取消', confirmText: '好', destructive: false },
        authChecking: true, authReady: false, authError: '', routesError: '',
        form: {
            title: '', date: '2026-08-15', time: '06:30', meetingPoint: '', meetingLatitude: undefined, meetingLongitude: undefined,
            routeId: '', distanceKm: 0, elevationGainM: 0, difficulty: '中等', capacity: 16, speedRange: '23-26 km/h',
            description: '',
            requirements: { equipment: [], recentDistanceKm: 50, recentElevationM: 400, bikeTypes: [], disciplines: [], customNote: '' },
        },
        equipmentOptions: [
            { label: '骑行头盔', selected: true }, { label: '前后车灯', selected: true },
            { label: '补胎工具', selected: true }, { label: '备用内胎', selected: true },
            { label: '锁鞋', selected: false }, { label: '对讲设备', selected: false },
        ],
        bikeOptions: [
            { label: '公路车', selected: true }, { label: '砾石车', selected: true },
            { label: '山地车', selected: false }, { label: '铁三车', selected: false },
        ],
        disciplineOptions: [
            { label: '听从领队指挥', selected: true }, { label: '保持安全车距', selected: true },
            { label: '下坡禁止超车', selected: true }, { label: '掉队原地等收队', selected: true },
        ],
    },
    async onLoad() {
        this.syncRequirements();
        await Promise.all([this.loadRoutes(), this.checkLogin()]);
    },
    onUnload() {
        if (keyboardCloseTimer)
            clearTimeout(keyboardCloseTimer);
        keyboardCloseTimer = null;
    },
    async checkLogin() {
        if (!wx.getStorageSync('auth_token')) {
            this.setData({ authChecking: false, authReady: false, authError: '授权微信头像和昵称后即可发布活动' });
            return;
        }
        this.setData({ authChecking: true, authError: '' });
        try {
            await api_1.api.login();
            this.setData({ authChecking: false, authReady: true });
        }
        catch (error) {
            this.setData({ authChecking: false, authReady: false, authError: (0, presentation_1.errorMessage)(error) });
        }
    },
    authorizeLogin() { wx.navigateTo({ url: '/pages/privacy/index?intent=publish' }); },
    async loadRoutes() {
        this.setData({ routesError: '' });
        try {
            const routes = await api_1.api.listRoutes();
            this.setData({ routes, routeOptions: [{ name: '不选择路书', route: null }, ...routes.map((route) => ({ name: route.name, route }))] });
        }
        catch (error) {
            this.setData({ routesError: (0, presentation_1.errorMessage)(error) });
        }
    },
    onField(event) {
        const field = String(event.currentTarget.dataset.field || '');
        const value = event.detail.value;
        this.setData({ [`form.${field}`]: value });
        if (field === 'meetingPoint') {
            this.setData({ 'form.meetingLatitude': undefined, 'form.meetingLongitude': undefined });
            this.updateLocationSuggestions(value);
        }
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
        keyboardCloseTimer = setTimeout(() => {
            this.setData({ keyboardOpen: false });
            keyboardCloseTimer = null;
        }, 120);
    },
    showLocationSuggestions() {
        this.onKeyboardOpen();
        this.updateLocationSuggestions(this.data.form.meetingPoint);
    },
    updateLocationSuggestions(value) {
        const query = value.trim().toLowerCase();
        const recent = (wx.getStorageSync(RECENT_MEETING_POINTS_KEY) || []);
        const routePoints = this.data.routes.flatMap((route) => route.pois
            .filter((poi) => poi.kind === 'meeting' || poi.kind === 'supply')
            .map((poi) => ({ label: poi.name, note: `${route.name} · ${poi.note}`, latitude: poi.latitude, longitude: poi.longitude })));
        const recentPoints = recent.map((label) => ({ label, note: '最近使用' }));
        const seen = new Set();
        const suggestions = [...recentPoints, ...routePoints]
            .filter((item) => item.label && (!query || `${item.label}${item.note}`.toLowerCase().includes(query)))
            .filter((item) => { if (seen.has(item.label))
            return false; seen.add(item.label); return item.label !== value.trim(); })
            .slice(0, 6);
        this.setData({ locationSuggestions: suggestions, showLocationSuggestions: suggestions.length > 0 });
    },
    chooseMeetingPoint(event) {
        const label = String(event.currentTarget.dataset.label || '');
        if (!label)
            return;
        const selected = this.data.locationSuggestions.find((item) => item.label === label);
        const recent = (wx.getStorageSync(RECENT_MEETING_POINTS_KEY) || []);
        wx.setStorageSync(RECENT_MEETING_POINTS_KEY, [label, ...recent.filter((item) => item !== label)].slice(0, 8));
        this.setData({ 'form.meetingPoint': label, 'form.meetingLatitude': selected?.latitude, 'form.meetingLongitude': selected?.longitude, showLocationSuggestions: false });
    },
    chooseMeetingPointOnMap() {
        wx.chooseLocation({
            success: (result) => {
                if (!result.name && !result.address)
                    return;
                const label = result.name || result.address;
                const recent = (wx.getStorageSync(RECENT_MEETING_POINTS_KEY) || []);
                wx.setStorageSync(RECENT_MEETING_POINTS_KEY, [label, ...recent.filter((item) => item !== label)].slice(0, 8));
                this.setData({ 'form.meetingPoint': label, 'form.meetingLatitude': result.latitude, 'form.meetingLongitude': result.longitude, showLocationSuggestions: false });
            },
            fail: () => undefined,
        });
    },
    hideLocationSuggestions() {
        this.onKeyboardClose();
        setTimeout(() => this.setData({ showLocationSuggestions: false }), 160);
    },
    noop() { },
    resolveAppleModal(event) { (0, apple_modal_1.resolveAppleModal)(this, String(event.currentTarget.dataset.confirm) === 'true'); },
    resetForNewEvent() {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        this.setData({
            selectedRoute: null, routeIndex: 0, coverPreview: '', locationSuggestions: [], showLocationSuggestions: false, keyboardOpen: false,
            form: {
                title: '', date, time: '06:30', meetingPoint: '', meetingLatitude: undefined, meetingLongitude: undefined, routeId: '', distanceKm: 0, elevationGainM: 0,
                difficulty: '中等', capacity: 16, speedRange: '23-26 km/h', description: '',
                requirements: { equipment: [], recentDistanceKm: 50, recentElevationM: 400, bikeTypes: [], disciplines: [], customNote: '' },
            },
            equipmentOptions: this.data.equipmentOptions.map((item) => ({ ...item, selected: ['骑行头盔', '前后车灯', '补胎工具', '备用内胎'].includes(item.label) })),
            bikeOptions: this.data.bikeOptions.map((item) => ({ ...item, selected: ['公路车', '砾石车'].includes(item.label) })),
            disciplineOptions: this.data.disciplineOptions.map((item) => ({ ...item, selected: true })),
        }, () => this.syncRequirements());
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
    importGpx() {
        if (this.data.importingGpx)
            return;
        wx.chooseMessageFile({ count: 1, type: 'file', extension: ['gpx'], success: async (result) => {
                const file = result.tempFiles[0];
                if (!file || !/\.gpx$/i.test(file.name || ''))
                    return wx.showToast({ title: '请选择 GPX 文件', icon: 'none' });
                if (file.size && file.size > 2 * 1024 * 1024)
                    return wx.showToast({ title: 'GPX 文件不能超过 2MB', icon: 'none' });
                this.setData({ importingGpx: true });
                try {
                    const route = await api_1.api.importGpx(file.path, file.name);
                    const routes = [route, ...this.data.routes.filter((item) => item.id !== route.id)];
                    this.setData({ routes, routeOptions: [{ name: '不选择路书', route: null }, ...routes.map((item) => ({ name: item.name, route: item }))], selectedRoute: route, routeIndex: 1, 'form.routeId': route.id, 'form.distanceKm': route.distanceKm, 'form.elevationGainM': route.elevationGainM, 'form.difficulty': route.difficulty, difficultyIndex: Math.max(0, this.data.difficultyOptions.indexOf(route.difficulty)) });
                    wx.showToast({ title: 'GPX 路书已导入', icon: 'success' });
                }
                catch (error) {
                    wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
                }
                finally {
                    this.setData({ importingGpx: false });
                }
            } });
    },
    chooseCover() {
        wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: (result) => {
                const filePath = result.tempFilePaths[0];
                if (filePath)
                    this.setData({ coverPreview: filePath, 'form.coverFilePath': filePath });
            }, fail: () => undefined });
    },
    toggleOption(event) {
        const group = event.currentTarget.dataset.group;
        const index = Number(event.currentTarget.dataset.index);
        const options = this.data[group].map((item, itemIndex) => itemIndex === index ? { ...item, selected: !item.selected } : item);
        this.setData({ [group]: options }, () => this.syncRequirements());
    },
    syncRequirements() {
        this.setData({
            'form.requirements.equipment': this.data.equipmentOptions.filter((item) => item.selected).map((item) => item.label),
            'form.requirements.bikeTypes': this.data.bikeOptions.filter((item) => item.selected).map((item) => item.label),
            'form.requirements.disciplines': this.data.disciplineOptions.filter((item) => item.selected).map((item) => item.label),
        });
    },
    async submit() {
        if (this.data.submitting)
            return;
        if (!this.data.authReady)
            return wx.showToast({ title: '请先完成登录', icon: 'none' });
        this.syncRequirements();
        const validation = (0, domain_1.validatePublish)(this.data.form);
        if (!validation.valid)
            return wx.showToast({ title: validation.message, icon: 'none' });
        this.setData({ submitting: true });
        try {
            await api_1.api.publish(this.data.form);
            await (0, apple_modal_1.openAppleModal)(this, {
                title: '活动已发布',
                content: '活动已进入公开列表，可在“我的活动”中继续管理。',
                showCancel: false,
                confirmText: '查看活动',
            });
            this.resetForNewEvent();
            wx.switchTab({ url: '/pages/mine/index' });
        }
        catch (error) {
            await (0, apple_modal_1.openAppleModal)(this, { title: '发布失败', content: (0, presentation_1.errorMessage)(error), showCancel: false, confirmText: '知道了' });
        }
        finally {
            this.setData({ submitting: false });
        }
    },
});
