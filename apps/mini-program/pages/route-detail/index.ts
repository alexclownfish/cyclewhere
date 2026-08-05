import { api } from '../../services/api';
import type { RideRoute } from '../../types/domain';
import { formatDuration } from '../../utils/domain';
import { errorMessage } from '../../utils/presentation';

interface RoutePolyline {
  points: Array<{ latitude: number; longitude: number }>;
  color: string;
  width: number;
  dottedLine: boolean;
  arrowLine: boolean;
}

interface RouteMarker {
  id: number;
  latitude: number;
  longitude: number;
  width: number;
  height: number;
  callout: { content: string; display: 'BYCLICK'; padding: number; borderRadius: number };
}

Page({
  data: {
    id: '', route: null as RideRoute | null, loading: true, error: '', durationText: '', maxGradientText: '', profileEstimated: false,
    latitude: 40.02, longitude: 116.10, polyline: [] as RoutePolyline[],
    markers: [] as RouteMarker[], elevationBars: [] as number[],
  },
  onLoad(options: Record<string, string>) { this.setData({ id: options.id || 'route-shisanling' }); this.loadRoute(); },
  async loadRoute() {
    this.setData({ loading: true, error: '' });
    try {
      const route = await api.getRoute(this.data.id);
      const center = route.track[Math.floor(route.track.length / 2)];
      const maxElevation = Math.max(...route.elevationProfile);
      const elevationBars = route.elevationProfile.map((value) => Math.max(10, Math.round(value / maxElevation * 100)));
      const markers = route.pois.map((poi, index) => ({
        id: index + 1, latitude: poi.latitude, longitude: poi.longitude, width: 24, height: 24,
        callout: { content: poi.name, display: 'BYCLICK' as const, padding: 6, borderRadius: 4 },
      }));
      this.setData({
        route, loading: false, latitude: center.latitude, longitude: center.longitude,
        durationText: formatDuration(route.durationMinutes), elevationBars, markers,
        maxGradientText: `${route.maxGradient}%`, profileEstimated: false,
        polyline: [{ points: route.track, color: '#d9433b', width: 6, dottedLine: false, arrowLine: true }],
      });
    } catch (error) { this.setData({ loading: false, error: errorMessage(error) }); }
  },
  openStart() {
    const first = this.data.route?.pois[0];
    if (!first) return;
    wx.openLocation({ latitude: first.latitude, longitude: first.longitude, name: first.name, address: first.note, scale: 15 });
  },
});
