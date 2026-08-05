import { api } from '../../services/api';
import type { RegistrationStatus, RideEvent } from '../../types/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';

interface MyEventView extends RideEvent { dateText: string; statusText: string; statusTone: string; }

const statusMap: Record<RegistrationStatus, { text: string; tone: string }> = {
  pending: { text: '待审核', tone: 'badge-amber' }, approved: { text: '已报名', tone: 'badge-green' },
  rejected: { text: '未通过', tone: 'badge-red' }, cancelled: { text: '已取消', tone: '' },
};

Page({
  data: { active: 'registered', loading: true, error: '', registered: [] as MyEventView[], published: [] as MyEventView[] },
  onShow() { this.loadMine(); },
  async loadMine() {
    this.setData({ loading: true, error: '' });
    try {
      const [events, records] = await Promise.all([api.listEvents(), api.getMyRegistrationRecords()]);
      const registered = records.map(({ registration, event }) => {
        const status = statusMap[registration.status];
        return { ...event, dateText: formatRideDate(event.startAt), statusText: status.text, statusTone: status.tone };
      }) as MyEventView[];
      const published = events.filter((item) => item.ownedByMe).map((item) => ({ ...item, dateText: formatRideDate(item.startAt), statusText: '已发布', statusTone: 'badge-green' }));
      this.setData({ registered, published, loading: false });
    } catch (error) { this.setData({ loading: false, error: errorMessage(error) }); }
  },
  switchSegment(event: WechatMiniprogram.TouchEvent) { this.setData({ active: event.currentTarget.dataset.value }); },
  openEvent(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/event-detail/index?id=${event.currentTarget.dataset.id}` }); },
  goExplore() { wx.switchTab({ url: '/pages/events/index' }); },
  goPublish() { wx.switchTab({ url: '/pages/publish/index' }); },
});
