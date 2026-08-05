import { api } from '../../services/api';
import type { RegistrationInput, RideEvent } from '../../types/domain';
import { makeIdempotencyKey, validateRegistration } from '../../utils/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';

Page({
  data: {
    eventId: '', intentKey: '', event: null as RideEvent | null, loading: true, submitting: false, success: false, successCopy: '', dateText: '',
    bikeTypes: ['公路车', '砾石车', '山地车'], bikeIndex: 0,
    form: { phone: '', emergencyContact: '', bikeType: '公路车', abilityConfirmed: false, waiverConfirmed: false } as RegistrationInput,
  },
  onLoad(options: Record<string, string>) {
    const eventId = options.eventId || '';
    this.setData({ eventId, intentKey: makeIdempotencyKey(eventId) });
    this.loadEvent();
  },
  async loadEvent() {
    try {
      const event = await api.getEvent(this.data.eventId);
      this.setData({ event, dateText: formatRideDate(event.startAt), loading: false });
    } catch (error) { this.setData({ loading: false }); wx.showToast({ title: errorMessage(error), icon: 'none' }); }
  },
  onField(event: WechatMiniprogram.Input) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  chooseBike(event: WechatMiniprogram.PickerChange) {
    const bikeIndex = Number(event.detail.value);
    this.setData({ bikeIndex, 'form.bikeType': this.data.bikeTypes[bikeIndex] });
  },
  toggleConfirm(event: WechatMiniprogram.TouchEvent) {
    const field = event.currentTarget.dataset.field as 'abilityConfirmed' | 'waiverConfirmed';
    this.setData({ [`form.${field}`]: !this.data.form[field] });
  },
  async submit() {
    if (this.data.submitting) return;
    const validation = validateRegistration(this.data.form);
    if (!validation.valid) return wx.showToast({ title: validation.message, icon: 'none' });
    this.setData({ submitting: true });
    try {
      const registration = await api.register(this.data.eventId, this.data.form, this.data.intentKey);
      const successCopy = registration.status === 'pending'
        ? '报名已进入审核，组织者将在 24 小时内处理；结果会通过服务通知发送。'
        : '名额已确认，请按活动要求准备装备并留意出发前的活动变更。';
      this.setData({ success: true, successCopy });
    } catch (error) { wx.showToast({ title: errorMessage(error), icon: 'none' }); }
    finally { this.setData({ submitting: false }); }
  },
  goMine() { wx.switchTab({ url: '/pages/mine/index' }); },
});
