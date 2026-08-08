"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
Page({
    data: {
        id: '', route: null, loading: true, error: '', durationText: '', maxGradientText: '', profileEstimated: false,
        latitude: 40.02, longitude: 116.10, polyline: [],
        markers: [], elevationBars: [],
    },
    onLoad(options) { this.setData({ id: options.id || 'route-shisanling' }); this.loadRoute(); },
    async loadRoute() {
        this.setData({ loading: true, error: '' });
        try {
            const route = await api_1.api.getRoute(this.data.id);
            const center = route.track[Math.floor(route.track.length / 2)];
            const maxElevation = Math.max(...route.elevationProfile);
            const elevationBars = route.elevationProfile.map((value) => Math.max(10, Math.round(value / maxElevation * 100)));
            const markers = route.pois.map((poi, index) => ({
                id: index + 1, latitude: poi.latitude, longitude: poi.longitude, width: 24, height: 24,
                callout: { content: poi.name, display: 'BYCLICK', padding: 6, borderRadius: 4 },
            }));
            this.setData({
                route, loading: false, latitude: center.latitude, longitude: center.longitude,
                durationText: (0, domain_1.formatDuration)(route.durationMinutes), elevationBars, markers,
                maxGradientText: `${route.maxGradient}%`, profileEstimated: false,
                polyline: [{ points: route.track, color: '#d9433b', width: 6, dottedLine: false, arrowLine: true }],
            });
        }
        catch (error) {
            this.setData({ loading: false, error: (0, presentation_1.errorMessage)(error) });
        }
    },
    openStart() {
        const first = this.data.route?.pois[0];
        if (!first)
            return;
        wx.openLocation({ latitude: first.latitude, longitude: first.longitude, name: first.name, address: first.note, scale: 15 });
    },
});
