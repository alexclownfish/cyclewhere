import { api } from '../../services/api';
import type { RegistrationInput, RideEvent } from '../../types/domain';
import { makeIdempotencyKey, validateRegistration } from '../../utils/domain';
import { errorMessage, formatRideDate } from '../../utils/presentation';
import { openAppleModal, resolveAppleModal as completeAppleModal, type AppleModalState } from '../../utils/apple-modal';

Page({
  data: {
    eventId: '', intentKey: '', event: null as RideEvent | null, loading: true, submitting: false, success: false, successCopy: '', dateText: '',
    bikeTypes: ['公路车', '砾石车', '山地车'], bikeIndex: 0,
    form: { phone: '', emergencyContact: '', bikeType: '公路车', abilityConfirmed: false, waiverConfirmed: false } as RegistrationInput,
    appleModal: { visible: false, title: '', content: '', showCancel: true, cancelText: '取消', confirmText: '好', destructive: false } as AppleModalState,
  },
  onLoad(options: Record<string, string>) {
    const eventId = options.eventId || '';
    this.setData({ eventId, intentKey: makeIdempotencyKey(eventId) });
    this.loadEvent();
  },
  noop() {},
  resolveAppleModal(event: WechatMiniprogram.TouchEvent) { completeAppleModal(this, String(event.currentTarget.dataset.confirm) === 'true'); },
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
    if (!wx.getStorageSync('auth_token')) {
      const result = await openAppleModal(this, { title: '请先登录', content: '授权微信头像和昵称后即完成注册，随后可继续报名。', confirmText: '去登录' });
      if (result.confirm) wx.switchTab({ url: '/pages/mine/index' });
      return;
    }
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
