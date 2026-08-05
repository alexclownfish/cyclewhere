import { api } from '../../services/api';
import type { Registration, RideEvent } from '../../types/domain';
import { canRegister, remainingPlaces } from '../../utils/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';

Page({
  data: {
    id: '', loading: true, error: '', event: null as RideEvent | null,
    dateText: '', remaining: 0, bikeTypesText: '', statusText: '', registration: null as Registration | null,
    canRegisterNow: false, actionText: '报名参加', cancelling: false,
  },
  onLoad(options: Record<string, string>) { this.setData({ id: options.id || 'event-miaofeng' }); },
  onShow() { if (this.data.id) this.loadDetail(); },
  async loadDetail() {
    this.setData({ loading: true, error: '' });
    try {
      const [event, status] = await Promise.all([api.getEvent(this.data.id), api.getRegistrationStatus(this.data.id)]);
      const registration = status?.status !== 'cancelled' ? status : null;
      const canRegisterNow = canRegister(event);
      const deadlineClosed = Date.parse(event.registrationDeadline) <= Date.now();
      const actionText = registration
        ? (registration.status === 'pending' ? '审核中 · 查看我的活动' : '已报名 · 查看我的活动')
        : deadlineClosed ? '报名已截止' : `报名参加 · 剩余 ${remainingPlaces(event)} 位`;
      this.setData({
        event, registration, loading: false, dateText: formatRideDate(event.startAt), remaining: remainingPlaces(event),
        bikeTypesText: event.requirements.bikeTypes.join(' / '),
        statusText: event.status === 'full' ? '名额已满' : event.status === 'completed' ? '已结束' : deadlineClosed ? '报名已截止' : '报名中',
        canRegisterNow, actionText,
      });
    } catch (error) { this.setData({ loading: false, error: errorMessage(error) }); }
  },
  openRoute() {
    if (!this.data.event?.routeId) return wx.showToast({ title: '该活动暂未关联公开路书', icon: 'none' });
    wx.navigateTo({ url: `/pages/route-detail/index?id=${this.data.event.routeId}` });
  },
  handlePrimary() {
    if (this.data.registration) return wx.switchTab({ url: '/pages/mine/index' });
    if (!this.data.canRegisterNow) return wx.showToast({ title: '当前不可报名', icon: 'none' });
    wx.navigateTo({ url: `/pages/register/index?eventId=${this.data.id}` });
  },
  async cancelRegistration() {
    const result = await wx.showModal({ title: '确认取消报名？', content: '取消后名额将立即释放，请确认行程后操作。', confirmColor: '#d9433b' });
    if (!result.confirm) return;
    this.setData({ cancelling: true });
    try {
      await api.cancelRegistration(this.data.id);
      wx.showToast({ title: '已取消报名', icon: 'success' });
      await this.loadDetail();
    } catch (error) { wx.showToast({ title: errorMessage(error), icon: 'none' }); }
    finally { this.setData({ cancelling: false }); }
  },
});
