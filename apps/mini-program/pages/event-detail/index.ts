import { api } from '../../services/api';
import type { EventParticipant, EventParticipantContact, Registration, RideEvent } from '../../types/domain';
import { canRegister, remainingPlaces } from '../../utils/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';

interface ParticipantView extends EventParticipant {
  key: number;
  displayName: string;
  avatarText: string;
  contactLoading?: boolean;
}

function presentParticipants(items: EventParticipant[]): ParticipantView[] {
  return items.map((item, key) => {
    const displayName = item.nickname?.trim() || '微信骑友';
    return { ...item, key, displayName, avatarText: displayName.slice(0, 1) || '骑' };
  });
}

Page({
  data: {
    id: '', loading: true, error: '', event: null as RideEvent | null,
    dateText: '', remaining: 0, bikeTypesText: '', statusText: '', registration: null as Registration | null, organizerInitial: '组',
    canRegisterNow: false, actionText: '报名参加', cancelling: false,
    participants: [] as ParticipantView[], participantsLoading: false, participantsError: '',
    participantLoadGeneration: 0,
  },
  onLoad(options: Record<string, string>) { this.setData({ id: options.id || 'event-miaofeng' }); },
  onShow() { if (this.data.id) this.loadDetail(); },
  async loadDetail() {
    const participantLoadGeneration = this.data.participantLoadGeneration + 1;
    this.setData({ loading: true, error: '', participantsLoading: true, participantsError: '', participantLoadGeneration });
    try {
      const participantsRequest = api.getEventParticipants(this.data.id)
        .then((items) => ({ items: presentParticipants(items), error: '' }))
        .catch((error) => ({ items: [] as ParticipantView[], error: errorMessage(error) }));
      const [event, status, participantState] = await Promise.all([
        api.getEvent(this.data.id),
        api.getRegistrationStatus(this.data.id),
        participantsRequest,
      ]);
      const registration = status?.status !== 'cancelled' ? status : null;
      const canRegisterNow = canRegister(event);
      const deadlineClosed = Date.parse(event.registrationDeadline) <= Date.now();
      const actionText = registration
        ? (registration.status === 'pending' ? '审核中 · 查看我的活动' : '已报名 · 查看我的活动')
        : deadlineClosed ? '报名已截止' : `报名参加 · 剩余 ${remainingPlaces(event)} 位`;
      if (this.data.participantLoadGeneration !== participantLoadGeneration) return;
      this.setData({
        event, registration, loading: false, dateText: formatRideDate(event.startAt), remaining: remainingPlaces(event), organizerInitial: event.organizer.slice(0, 1) || '组',
        bikeTypesText: event.requirements.bikeTypes.join(' / '),
        statusText: event.status === 'full' ? '名额已满' : event.status === 'completed' ? '已结束' : deadlineClosed ? '报名已截止' : '报名中',
        canRegisterNow, actionText, participants: participantState.items,
        participantsLoading: false, participantsError: participantState.error,
      });
    } catch (error) { this.setData({ loading: false, participantsLoading: false, error: errorMessage(error) }); }
  },
  async loadParticipants() {
    const participantLoadGeneration = this.data.participantLoadGeneration + 1;
    this.setData({ participantsLoading: true, participantsError: '', participantLoadGeneration });
    try {
      const participants = presentParticipants(await api.getEventParticipants(this.data.id));
      if (this.data.participantLoadGeneration !== participantLoadGeneration) return;
      this.setData({ participants, participantsLoading: false });
    } catch (error) {
      if (this.data.participantLoadGeneration !== participantLoadGeneration) return;
      this.setData({ participantsLoading: false, participantsError: errorMessage(error) });
    }
  },
  async openParticipant(event: { currentTarget: { dataset: { participantIndex: number } } }) {
    const participant = this.data.participants[Number(event.currentTarget.dataset.participantIndex)];
    if (!participant) return;
    if (!this.data.event?.ownedByMe || participant.isOrganizer || !participant.contactId) return;
    this.setData({ participants: this.data.participants.map((item) => item.key === participant.key ? { ...item, contactLoading: true } : item) });
    try {
      const contact: EventParticipantContact = await api.getEventParticipantContact(this.data.id, participant.contactId);
      await wx.showModal({
        title: contact.nickname || participant.displayName,
        content: `手机号：${contact.phone}\n紧急联系人：${contact.emergencyContact}\n车型：${contact.bikeType}`,
        showCancel: false,
      });
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' });
    } finally {
      this.setData({ participants: this.data.participants.map((item) => item.key === participant.key ? { ...item, contactLoading: false } : item) });
    }
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
