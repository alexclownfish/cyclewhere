"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const presentation_1 = require("../../utils/presentation");
const domain_1 = require("../../utils/domain");
Page({
    data: { loading: true, error: '', routes: [] },
    onShow() { this.loadRoutes(); },
    async loadRoutes() {
        this.setData({ loading: true, error: '' });
        try {
            const routes = await api_1.api.listRoutes();
            this.setData({ routes: routes.map((item) => ({
                    ...item, durationText: (0, domain_1.formatDuration)(item.durationMinutes), maxGradientText: `${item.maxGradient}%`,
                })), loading: false });
        }
        catch (error) {
            this.setData({ loading: false, error: (0, presentation_1.errorMessage)(error) });
        }
    },
    openRoute(event) { wx.navigateTo({ url: `/pages/route-detail/index?id=${event.currentTarget.dataset.id}` }); },
});
