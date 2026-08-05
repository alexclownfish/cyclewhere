import type { PublishEventInput, RegistrationInput, RideEvent } from '../types/domain.ts';

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function remainingPlaces(event: Pick<RideEvent, 'capacity' | 'registeredCount'>): number {
  return Math.max(0, event.capacity - event.registeredCount);
}

export function canRegister(
  event: Pick<RideEvent, 'status' | 'capacity' | 'registeredCount' | 'registrationDeadline'>,
  nowMs = Date.now(),
): boolean {
  return event.status === 'published'
    && remainingPlaces(event) > 0
    && Date.parse(event.registrationDeadline) > nowMs;
}

export function validateRegistration(input: RegistrationInput): ValidationResult {
  if (!/^1[3-9]\d{9}$/.test(input.phone.trim())) return { valid: false, message: '请输入有效的 11 位手机号' };
  if (input.emergencyContact.trim().length < 4) return { valid: false, message: '请填写紧急联系人及电话' };
  if (!input.bikeType) return { valid: false, message: '请选择车辆类型' };
  if (!input.abilityConfirmed) return { valid: false, message: '请确认能力与装备要求' };
  if (!input.waiverConfirmed) return { valid: false, message: '请阅读并同意风险说明' };
  return { valid: true, message: '' };
}

export function validatePublish(input: PublishEventInput): ValidationResult {
  if (input.title.trim().length < 4) return { valid: false, message: '活动名称至少 4 个字' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { valid: false, message: '请选择出发日期' };
  if (!/^\d{2}:\d{2}$/.test(input.time)) return { valid: false, message: '请选择集合时间' };
  if (input.meetingPoint.trim().length < 4) return { valid: false, message: '请填写明确的集合地点' };
  if (input.description.trim().length < 10) return { valid: false, message: '活动与安全说明至少 10 个字' };
  if (input.capacity < 2 || input.capacity > 200) return { valid: false, message: '人数限制应为 2 至 200 人' };
  if (input.requirements.equipment.length === 0) return { valid: false, message: '请至少选择一项必备装备' };
  if (input.requirements.bikeTypes.length === 0) return { valid: false, message: '请至少选择一种允许车型' };
  if (input.requirements.disciplines.length === 0) return { valid: false, message: '请至少选择一项骑行纪律' };
  if (input.requirements.recentDistanceKm < 0 || input.requirements.recentDistanceKm > 1000) return { valid: false, message: '近期距离应为 0 至 1000 km' };
  if (input.requirements.recentElevationM < 0 || input.requirements.recentElevationM > 30000) return { valid: false, message: '近期爬升应为 0 至 30000 m' };
  return { valid: true, message: '' };
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

export function makeIdempotencyKey(eventId: string, now = Date.now()): string {
  return `registration-${eventId}-${now}`;
}
