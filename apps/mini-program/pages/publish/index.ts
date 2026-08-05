import { api } from '../../services/api';
import type { PublishEventInput, RideRoute } from '../../types/domain';
import { validatePublish } from '../../utils/domain';
import { errorMessage } from '../../utils/presentation';

interface SelectOption { label: string; selected: boolean; }

Page({
  data: {
    routes: [] as RideRoute[], selectedRoute: null as RideRoute | null, routeIndex: 0, submitting: false,
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
  onLoad() { this.loadRoutes(); this.syncRequirements(); },
  async loadRoutes() {
    try {
      const routes = await api.listRoutes();
      const routeIndex = Math.max(0, routes.findIndex((item) => item.id === 'route-shisanling'));
      this.setData({ routes, selectedRoute: routes[routeIndex] || null, routeIndex, 'form.routeId': routes[routeIndex]?.id || '' });
    } catch (error) { wx.showToast({ title: errorMessage(error), icon: 'none' }); }
  },
  onField(event: WechatMiniprogram.Input) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  onNumber(event: WechatMiniprogram.Input) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: Number(event.detail.value) }); },
  onDate(event: WechatMiniprogram.PickerChange) { this.setData({ 'form.date': event.detail.value }); },
  onTime(event: WechatMiniprogram.PickerChange) { this.setData({ 'form.time': event.detail.value }); },
  onRoute(event: WechatMiniprogram.PickerChange) {
    const routeIndex = Number(event.detail.value);
    this.setData({ routeIndex, selectedRoute: this.data.routes[routeIndex], 'form.routeId': this.data.routes[routeIndex].id });
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
    this.syncRequirements();
    const validation = validatePublish(this.data.form);
    if (!validation.valid) return wx.showToast({ title: validation.message, icon: 'none' });
    this.setData({ submitting: true });
    try {
      await api.publish(this.data.form);
      await wx.showModal({ title: '活动已发布', content: '活动已进入公开列表，可在“我的活动”中继续管理。', showCancel: false, confirmText: '查看活动' });
      wx.switchTab({ url: '/pages/mine/index' });
    } catch (error) { wx.showToast({ title: errorMessage(error), icon: 'none' }); }
    finally { this.setData({ submitting: false }); }
  },
});
