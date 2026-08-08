"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
Page({
    data: {
        routes: [], routeOptions: [{ name: '不选择路书', route: null }], selectedRoute: null, routeIndex: 0, submitting: false, editingId: '', importingGpx: false,
        difficultyOptions: ['轻松', '中等', '进阶'], difficultyIndex: 1,
        coverPreview: '',
        authChecking: true, authReady: false, authError: '', routesError: '',
        form: {
            title: '十三陵水库周末拉练', date: '2026-08-15', time: '06:30', meetingPoint: '北邵洼地铁站 B 口',
            routeId: '', distanceKm: 0, elevationGainM: 0, difficulty: '中等', capacity: 16, speedRange: '23-26 km/h',
            description: '稳定巡航，设置领队与收队。遇中雨或道路管制将提前取消并通知。',
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
    async onLoad(options) {
        this.syncRequirements();
        await Promise.all([this.loadRoutes(), this.checkLogin()]);
        if (options.id) {
            this.setData({ editingId: options.id });
            await this.loadEditingEvent(options.id);
        }
    },
    async loadEditingEvent(id) {
        try {
            const event = await api_1.api.getEvent(id);
            const start = new Date(event.startAt);
            const foundIndex = this.data.routes.findIndex((item) => item.id === event.routeId);
            const selectedRoute = foundIndex >= 0 ? this.data.routes[foundIndex] : null;
            const difficultyIndex = Math.max(0, this.data.difficultyOptions.indexOf(event.route.difficulty));
            this.setData({ routeIndex: foundIndex >= 0 ? foundIndex + 1 : 0, selectedRoute, difficultyIndex, coverPreview: event.coverUrl || '', 'form.title': event.title, 'form.date': `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`, 'form.time': `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`, 'form.meetingPoint': event.meetingPoint, 'form.capacity': event.capacity, 'form.speedRange': event.speedRange, 'form.description': event.description, 'form.routeId': event.routeId, 'form.distanceKm': event.route.distanceKm, 'form.elevationGainM': event.route.elevationGainM, 'form.difficulty': event.route.difficulty, 'form.requirements': event.requirements });
            this.setData({ equipmentOptions: this.data.equipmentOptions.map((item) => ({ ...item, selected: event.requirements.equipment.includes(item.label) })), bikeOptions: this.data.bikeOptions.map((item) => ({ ...item, selected: event.requirements.bikeTypes.includes(item.label) })), disciplineOptions: this.data.disciplineOptions.map((item) => ({ ...item, selected: event.requirements.disciplines.includes(item.label) })) });
        }
        catch (error) {
            this.setData({ routesError: (0, presentation_1.errorMessage)(error) });
        }
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
    authorizeLogin() { wx.switchTab({ url: '/pages/mine/index' }); },
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
    onField(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
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
            if (this.data.editingId)
                await api_1.api.updateEvent(this.data.editingId, this.data.form);
            else
                await api_1.api.publish(this.data.form);
            await wx.showModal({
                title: this.data.editingId ? '活动已更新' : '活动已发布',
                content: this.data.editingId ? '修改内容已保存。' : '活动已进入公开列表，可在“我的活动”中继续管理。',
                showCancel: false,
                confirmText: '查看活动',
            });
            wx.switchTab({ url: '/pages/mine/index' });
        }
        catch (error) {
            await wx.showModal({ title: this.data.editingId ? '保存失败' : '发布失败', content: (0, presentation_1.errorMessage)(error), showCancel: false, confirmText: '知道了' });
        }
        finally {
            this.setData({ submitting: false });
        }
    },
});
