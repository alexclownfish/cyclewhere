"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../services/api");
const domain_1 = require("../../utils/domain");
const presentation_1 = require("../../utils/presentation");
const apple_modal_1 = require("../../utils/apple-modal");
function presentParticipants(items) {
    return items.map((item, key) => {
        const displayName = item.nickname?.trim() || '微信骑友';
        return { ...item, key, displayName, avatarText: displayName.slice(0, 1) || '骑' };
    });
}
Page({
    data: {
        id: '', loading: true, error: '', event: null,
        dateText: '', remaining: 0, bikeTypesText: '', statusText: '', registration: null, organizerInitial: '组',
        canRegisterNow: false, actionText: '报名参加', cancelling: false, eventCancelling: false,
        participants: [], participantsLoading: false, participantsError: '',
        participantLoadGeneration: 0,
        appleModal: { visible: false, title: '', content: '', showCancel: true, cancelText: '取消', confirmText: '好', destructive: false },
    },
    onLoad(options) { this.setData({ id: options.id || 'event-miaofeng' }); },
    onShow() { if (this.data.id)
        this.loadDetail(); },
    noop() { },
    resolveAppleModal(event) { (0, apple_modal_1.resolveAppleModal)(this, String(event.currentTarget.dataset.confirm) === 'true'); },
    async loadDetail() {
        const participantLoadGeneration = this.data.participantLoadGeneration + 1;
        this.setData({ loading: true, error: '', participantsLoading: true, participantsError: '', participantLoadGeneration });
        try {
            const participantsRequest = api_1.api.getEventParticipants(this.data.id)
                .then((items) => ({ items: presentParticipants(items), error: '' }))
                .catch((error) => ({ items: [], error: (0, presentation_1.errorMessage)(error) }));
            const [event, status, participantState] = await Promise.all([
                api_1.api.getEvent(this.data.id),
                api_1.api.getRegistrationStatus(this.data.id),
                participantsRequest,
            ]);
            const registration = status?.status !== 'cancelled' ? status : null;
            const canRegisterNow = (0, domain_1.canRegister)(event);
            const deadlineClosed = Date.parse(event.registrationDeadline) <= Date.now();
            const actionText = registration
                ? (registration.status === 'pending' ? '审核中 · 查看我的活动' : '已报名 · 查看我的活动')
                : deadlineClosed ? '报名已截止' : `报名参加 · 剩余 ${(0, domain_1.remainingPlaces)(event)} 位`;
            if (this.data.participantLoadGeneration !== participantLoadGeneration)
                return;
            this.setData({
                event, registration, loading: false, dateText: (0, presentation_1.formatRideDate)(event.startAt), remaining: (0, domain_1.remainingPlaces)(event), organizerInitial: event.organizer.slice(0, 1) || '组',
                bikeTypesText: event.requirements.bikeTypes.join(' / '),
                statusText: event.status === 'cancelled' ? '活动已取消' : event.status === 'full' ? '名额已满' : event.status === 'completed' ? '已结束' : deadlineClosed ? '报名已截止' : '报名中',
                canRegisterNow, actionText, participants: participantState.items,
                participantsLoading: false, participantsError: participantState.error,
            });
        }
        catch (error) {
            this.setData({ loading: false, participantsLoading: false, error: (0, presentation_1.errorMessage)(error) });
        }
    },
    async loadParticipants() {
        const participantLoadGeneration = this.data.participantLoadGeneration + 1;
        this.setData({ participantsLoading: true, participantsError: '', participantLoadGeneration });
        try {
            const participants = presentParticipants(await api_1.api.getEventParticipants(this.data.id));
            if (this.data.participantLoadGeneration !== participantLoadGeneration)
                return;
            this.setData({ participants, participantsLoading: false });
        }
        catch (error) {
            if (this.data.participantLoadGeneration !== participantLoadGeneration)
                return;
            this.setData({ participantsLoading: false, participantsError: (0, presentation_1.errorMessage)(error) });
        }
    },
    async openParticipant(event) {
        const participant = this.data.participants[Number(event.currentTarget.dataset.participantIndex)];
        if (!participant)
            return;
        if (!this.data.event?.ownedByMe || participant.isOrganizer || !participant.contactId)
            return;
        this.setData({ participants: this.data.participants.map((item) => item.key === participant.key ? { ...item, contactLoading: true } : item) });
        try {
            const contact = await api_1.api.getEventParticipantContact(this.data.id, participant.contactId);
            await (0, apple_modal_1.openAppleModal)(this, {
                title: contact.nickname || participant.displayName,
                content: `手机号：${contact.phone}\n紧急联系人：${contact.emergencyContact}\n车型：${contact.bikeType}`,
                showCancel: false,
            });
        }
        catch (error) {
            wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
        }
        finally {
            this.setData({ participants: this.data.participants.map((item) => item.key === participant.key ? { ...item, contactLoading: false } : item) });
        }
    },
    handlePrimary() {
        if (this.data.registration)
            return wx.switchTab({ url: '/pages/mine/index' });
        if (!this.data.canRegisterNow)
            return wx.showToast({ title: '当前不可报名', icon: 'none' });
        wx.navigateTo({ url: `/pages/register/index?eventId=${this.data.id}` });
    },
    openMeetingPoint() {
        const event = this.data.event;
        if (!event)
            return;
        const meetingPoint = event.route.pois.find((point) => point.kind === 'meeting');
        const coordinate = event.meetingLatitude != null && event.meetingLongitude != null
            ? { latitude: event.meetingLatitude, longitude: event.meetingLongitude }
            : meetingPoint || event.route.track[0];
        if (!coordinate) {
            wx.showToast({ title: '集合点暂未设置地图坐标', icon: 'none' });
            return;
        }
        wx.openLocation({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            name: event.meetingPoint,
            address: meetingPoint?.note || meetingPoint?.name || event.meetingPoint,
            scale: 16,
        });
    },
    openRoute() {
        const routeId = this.data.event?.routeId;
        if (!routeId) {
            wx.showToast({ title: '该活动暂未关联路书', icon: 'none' });
            return;
        }
        wx.navigateTo({ url: `/pages/route-detail/index?id=${encodeURIComponent(routeId)}` });
    },
    viewParticipants() {
        wx.pageScrollTo({ selector: '#participant-list', duration: 280 });
    },
    async cancelEvent() {
        if (!this.data.event?.ownedByMe || (this.data.event.status !== 'published' && this.data.event.status !== 'full'))
            return;
        const result = await (0, apple_modal_1.openAppleModal)(this, {
            title: '确认取消活动？',
            content: '取消后活动将停止报名并从公开活动中下架，此操作不可恢复。',
            confirmText: '取消活动',
            destructive: true,
        });
        if (!result.confirm)
            return;
        this.setData({ eventCancelling: true });
        try {
            await api_1.api.cancelEvent(this.data.id);
            wx.showToast({ title: '活动已取消', icon: 'success' });
            await this.loadDetail();
        }
        catch (error) {
            wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
        }
        finally {
            this.setData({ eventCancelling: false });
        }
    },
    async cancelRegistration() {
        const result = await (0, apple_modal_1.openAppleModal)(this, { title: '确认取消报名？', content: '取消后名额将立即释放，请确认行程后操作。', destructive: true });
        if (!result.confirm)
            return;
        this.setData({ cancelling: true });
        try {
            await api_1.api.cancelRegistration(this.data.id);
            wx.showToast({ title: '已取消报名', icon: 'success' });
            await this.loadDetail();
        }
        catch (error) {
            wx.showToast({ title: (0, presentation_1.errorMessage)(error), icon: 'none' });
        }
        finally {
            this.setData({ cancelling: false });
        }
    },
});
