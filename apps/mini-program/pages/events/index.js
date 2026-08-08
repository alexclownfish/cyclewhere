"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
Page({
    data: {
        loading: true,
        error: '',
        keyword: '',
        filter: '全部',
        filters: ['全部', '本周', '轻松', '进阶'],
        events: [],
        visibleEvents: [],
    },
    onShow() { this.loadEvents(); },
    async loadEvents() {
        this.setData({ loading: true, error: '' });
        try {
            const events = await api_1.api.listEvents();
            const views = events.filter((item) => item.status !== 'cancelled').map((item) => ({
                ...item, dateText: (0, presentation_1.formatRideDate)(item.startAt), remaining: (0, domain_1.remainingPlaces)(item),
                statusText: item.status === 'full' ? '名额已满' : item.status === 'completed' ? '已结束' : (0, domain_1.canRegister)(item) ? '报名中' : '报名已截止',
                statusTone: (0, domain_1.canRegister)(item) ? 'badge-red' : '',
            }));
            this.setData({ events: views, loading: false }, () => this.applyFilters());
        }
        catch (error) {
            this.setData({ loading: false, error: (0, presentation_1.errorMessage)(error) });
        }
    },
    onKeyword(event) {
        this.setData({ keyword: event.detail.value }, () => this.applyFilters());
    },
    chooseFilter(event) {
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
    openEvent(event) {
        wx.navigateTo({ url: `/pages/event-detail/index?id=${event.currentTarget.dataset.id}` });
    },
});
