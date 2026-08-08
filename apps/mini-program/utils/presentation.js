"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatRideDate = formatRideDate;
exports.errorMessage = errorMessage;
function formatRideDate(iso) {
    const date = new Date(iso);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
