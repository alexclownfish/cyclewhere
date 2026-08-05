import { api } from '../../services/api';
import type { RideRoute } from '../../types/domain';
import { errorMessage, } from '../../utils/presentation';
import { formatDuration } from '../../utils/domain';

interface RouteView extends RideRoute { durationText: string; maxGradientText: string; }

Page({
  data: { loading: true, error: '', routes: [] as RouteView[] },
  onShow() { this.loadRoutes(); },
  async loadRoutes() {
    this.setData({ loading: true, error: '' });
    try {
      const routes = await api.listRoutes();
      this.setData({ routes: routes.map((item) => ({
        ...item, durationText: formatDuration(item.durationMinutes), maxGradientText: `${item.maxGradient}%`,
      })), loading: false });
    } catch (error) { this.setData({ loading: false, error: errorMessage(error) }); }
  },
  openRoute(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/route-detail/index?id=${event.currentTarget.dataset.id}` }); },
});
