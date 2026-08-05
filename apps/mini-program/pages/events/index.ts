import { api } from '../../services/api';
import type { RideEvent } from '../../types/domain';
import { canRegister, remainingPlaces } from '../../utils/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';

interface EventView extends RideEvent { dateText: string; remaining: number; statusText: string; statusTone: string; }

Page({
  data: {
    loading: true,
    error: '',
    keyword: '',
    filter: '全部',
    filters: ['全部', '本周', '轻松', '进阶'],
    events: [] as EventView[],
    visibleEvents: [] as EventView[],
  },
  onShow() { this.loadEvents(); },
  async loadEvents() {
    this.setData({ loading: true, error: '' });
    try {
      const events = await api.listEvents();
      const views = events.filter((item) => item.status !== 'cancelled').map((item) => ({
        ...item, dateText: formatRideDate(item.startAt), remaining: remainingPlaces(item),
        statusText: item.status === 'full' ? '名额已满' : item.status === 'completed' ? '已结束' : canRegister(item) ? '报名中' : '报名已截止',
        statusTone: canRegister(item) ? 'badge-red' : '',
      }));
      this.setData({ events: views, loading: false }, () => this.applyFilters());
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) });
    }
  },
  onKeyword(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value }, () => this.applyFilters());
  },
  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    this.setData({ filter: event.currentTarget.dataset.value }, () => this.applyFilters());
  },
  applyFilters() {
    const { events, keyword, filter } = this.data;
    const text = keyword.trim().toLowerCase();
    const visibleEvents = events.filter((item) => {
      const matchesText = !text || `${item.title}${item.meetingPoint}${item.route.name}`.toLowerCase().includes(text);
      const matchesFilter = filter === '全部'
        || (filter === '轻松' && item.route.difficulty === '轻松')
        || (filter === '进阶' && item.route.difficulty === '进阶')
        || filter === '本周';
      return matchesText && matchesFilter;
    });
    this.setData({ visibleEvents });
  },
  openEvent(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/event-detail/index?id=${event.currentTarget.dataset.id}` });
  },
});
