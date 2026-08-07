import { api } from '../../services/api';
import type { PublishEventInput, RideRoute } from '../../types/domain';
import { validatePublish } from '../../utils/domain';
import { errorMessage } from '../../utils/presentation';

interface SelectOption { label: string; selected: boolean; }

Page({
  data: {
    routes: [] as RideRoute[], selectedRoute: null as RideRoute | null, routeIndex: 0, submitting: false, editingId: '', importingGpx: false,
    coverPreview: '',
    authChecking: true, authReady: false, authError: '', routesError: '',
    form: {
      title: '十三陵水库周末拉练', date: '2026-08-15', time: '06:30', meetingPoint: '北邵洼地铁站 B 口',
      routeId: 'route-miaofeng', capacity: 16, speedRange: '23-26 km/h',
      description: '稳定巡航，设置领队与收队。遇中雨或道路管制将提前取消并通知。',
      requirements: { equipment: [], recentDistanceKm: 50, recentElevationM: 400, bikeTypes: [], disciplines: [], customNote: '' },
    } as PublishEventInput,
    equipmentOptions: [
      { label: '骑行头盔', selected: true }, { label: '前后车灯', selected: true },
      { label: '补胎工具', selected: true }, { label: '备用内胎', selected: true },
      { label: '锁鞋', selected: false }, { label: '对讲设备', selected: false },
    ] as SelectOption[],
    bikeOptions: [
      { label: '公路车', selected: true }, { label: '砾石车', selected: true },
      { label: '山地车', selected: false }, { label: '铁三车', selected: false },
    ] as SelectOption[],
    disciplineOptions: [
      { label: '听从领队指挥', selected: true }, { label: '保持安全车距', selected: true },
      { label: '下坡禁止超车', selected: true }, { label: '掉队原地等收队', selected: true },
    ] as SelectOption[],
  },
  async onLoad(options: Record<string, string>) {
    this.syncRequirements();
    await Promise.all([this.loadRoutes(), this.checkLogin()]);
    if (options.id) { this.setData({ editingId: options.id }); await this.loadEditingEvent(options.id); }
  },
  async loadEditingEvent(id: string) {
    try {
      const event = await api.getEvent(id);
      const start = new Date(event.startAt);
      const routeIndex = Math.max(0, this.data.routes.findIndex((item) => item.id === event.routeId));
      this.setData({ routeIndex, selectedRoute: event.route, coverPreview: event.coverUrl || '', 'form.title': event.title, 'form.date': `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`, 'form.time': `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`, 'form.meetingPoint': event.meetingPoint, 'form.capacity': event.capacity, 'form.speedRange': event.speedRange, 'form.description': event.description, 'form.routeId': event.routeId, 'form.requirements': event.requirements });
      this.setData({ equipmentOptions: this.data.equipmentOptions.map((item) => ({ ...item, selected: event.requirements.equipment.includes(item.label) })), bikeOptions: this.data.bikeOptions.map((item) => ({ ...item, selected: event.requirements.bikeTypes.includes(item.label) })), disciplineOptions: this.data.disciplineOptions.map((item) => ({ ...item, selected: event.requirements.disciplines.includes(item.label) })) });
    } catch (error) { this.setData({ routesError: errorMessage(error) }); }
  },
  async checkLogin() {
    if (!wx.getStorageSync('auth_token')) {
      this.setData({ authChecking: false, authReady: false, authError: '授权微信头像和昵称后即可发布活动' });
      return;
    }
    this.setData({ authChecking: true, authError: '' });
    try {
      await api.login();
      this.setData({ authChecking: false, authReady: true });
    } catch (error) {
      this.setData({ authChecking: false, authReady: false, authError: errorMessage(error) });
    }
  },
  authorizeLogin() { wx.switchTab({ url: '/pages/mine/index' }); },
  async loadRoutes() {
    this.setData({ routesError: '' });
    try {
      const routes = await api.listRoutes();
      const routeIndex = Math.max(0, routes.findIndex((item) => item.id === 'route-shisanling'));
      this.setData({ routes, selectedRoute: routes[routeIndex] || null, routeIndex, 'form.routeId': routes[routeIndex]?.id || '' });
    } catch (error) { this.setData({ routesError: errorMessage(error) }); }
  },
  onField(event: WechatMiniprogram.Input) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  onNumber(event: WechatMiniprogram.Input) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: Number(event.detail.value) }); },
  onDate(event: WechatMiniprogram.PickerChange) { this.setData({ 'form.date': event.detail.value }); },
  onTime(event: WechatMiniprogram.PickerChange) { this.setData({ 'form.time': event.detail.value }); },
  onRoute(event: WechatMiniprogram.PickerChange) {
    const routeIndex = Number(event.detail.value);
    this.setData({ routeIndex, selectedRoute: this.data.routes[routeIndex], 'form.routeId': this.data.routes[routeIndex].id });
  },
  importGpx() {
    if (this.data.importingGpx) return;
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['gpx'], success: async (result) => {
      const file = result.tempFiles[0];
      if (!file || !/\.gpx$/i.test(file.name || '')) return wx.showToast({ title: '请选择 GPX 文件', icon: 'none' });
      if (file.size && file.size > 2 * 1024 * 1024) return wx.showToast({ title: 'GPX 文件不能超过 2MB', icon: 'none' });
      this.setData({ importingGpx: true });
      try {
        const route = await api.importGpx(file.path, file.name);
        const routes = [route, ...this.data.routes.filter((item) => item.id !== route.id)];
        this.setData({ routes, selectedRoute: route, routeIndex: 0, 'form.routeId': route.id });
        wx.showToast({ title: 'GPX 路书已导入', icon: 'success' });
      } catch (error) { wx.showToast({ title: errorMessage(error), icon: 'none' }); }
      finally { this.setData({ importingGpx: false }); }
    } });
  },
  chooseCover() {
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: (result) => {
      const filePath = result.tempFilePaths[0];
      if (filePath) this.setData({ coverPreview: filePath, 'form.coverFilePath': filePath });
    }, fail: () => undefined });
  },
  toggleOption(event: WechatMiniprogram.TouchEvent) {
    const group = event.currentTarget.dataset.group as 'equipmentOptions' | 'bikeOptions' | 'disciplineOptions';
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
    if (this.data.submitting) return;
    if (!this.data.authReady) return wx.showToast({ title: '请先完成登录', icon: 'none' });
    this.syncRequirements();
    const validation = validatePublish(this.data.form);
    if (!validation.valid) return wx.showToast({ title: validation.message, icon: 'none' });
    this.setData({ submitting: true });
    try {
      if (this.data.editingId) await api.updateEvent(this.data.editingId, this.data.form);
      else await api.publish(this.data.form);
      await wx.showModal({
        title: this.data.editingId ? '活动已更新' : '活动已发布',
        content: this.data.editingId ? '修改内容已保存。' : '活动已进入公开列表，可在“我的活动”中继续管理。',
        showCancel: false,
        confirmText: '查看活动',
      });
      wx.switchTab({ url: '/pages/mine/index' });
    } catch (error) {
      await wx.showModal({ title: this.data.editingId ? '保存失败' : '发布失败', content: errorMessage(error), showCancel: false, confirmText: '知道了' });
    }
    finally { this.setData({ submitting: false }); }
  },
});
