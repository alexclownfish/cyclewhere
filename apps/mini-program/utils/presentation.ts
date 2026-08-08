export function formatRideDate(iso: string): string {
  const date = new Date(iso);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function errorMessage(error: unknown): string {
  const candidate = error as { code?: unknown; details?: unknown; message?: unknown };
  if (candidate?.code === 'VALIDATION_ERROR') {
    const details = candidate.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    const labels: Record<string, string> = {
      routeId: '活动路书', title: '活动名称', summary: '活动说明', startAt: '出发时间', registrationDeadline: '报名截止时间',
      meetingPoint: '集合地点', difficulty: '活动难度', distanceKm: '预计距离', elevationGainM: '预计爬升',
      speedMinKph: '最低巡航速度', speedMaxKph: '最高巡航速度', capacity: '人数上限',
      equipmentRequirements: '必备装备', abilityRequirements: '能力要求', safetyNotice: '风险说明',
    };
    const fieldErrors = Object.entries(details?.fieldErrors || {}).flatMap(([field, messages]) =>
      messages.map((message) => `${labels[field] || field}：${message}`));
    const formErrors = details?.formErrors || [];
    const messages = [...fieldErrors, ...formErrors];
    return messages.length ? `请检查：${messages.join('；')}` : '请检查活动必填信息后再试';
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
