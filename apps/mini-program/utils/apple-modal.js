"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openAppleModal = openAppleModal;
exports.resolveAppleModal = resolveAppleModal;
function openAppleModal(page, options) {
    page.__appleModalResolve?.({ confirm: false, cancel: true });
    return new Promise((resolve) => {
        page.__appleModalResolve = resolve;
        page.setData({
            appleModal: {
                visible: true,
                title: options.title,
                content: options.content,
                showCancel: options.showCancel ?? true,
                cancelText: options.cancelText || '取消',
                confirmText: options.confirmText || '好',
                destructive: Boolean(options.destructive),
            },
        });
    });
}
function resolveAppleModal(page, confirm) {
    const resolve = page.__appleModalResolve;
    page.__appleModalResolve = undefined;
    const current = page.data.appleModal;
    page.setData({ appleModal: { ...current, visible: false } }, () => {
        resolve?.({ confirm, cancel: !confirm });
    });
}
