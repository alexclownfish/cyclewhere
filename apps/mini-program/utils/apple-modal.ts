export interface AppleModalOptions {
  title: string;
  content: string;
  showCancel?: boolean;
  cancelText?: string;
  confirmText?: string;
  destructive?: boolean;
}

interface ModalPage {
  data: { appleModal?: AppleModalState };
  setData(data: Record<string, unknown>, callback?: () => void): void;
  __appleModalResolve?: (result: { confirm: boolean; cancel: boolean }) => void;
}

export interface AppleModalState extends AppleModalOptions {
  visible: boolean;
  showCancel: boolean;
  cancelText: string;
  confirmText: string;
  destructive: boolean;
}

export function openAppleModal(page: ModalPage, options: AppleModalOptions): Promise<{ confirm: boolean; cancel: boolean }> {
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

export function resolveAppleModal(page: ModalPage, confirm: boolean): void {
  const resolve = page.__appleModalResolve;
  page.__appleModalResolve = undefined;
  const current = page.data.appleModal;
  page.setData({ appleModal: { ...(current as AppleModalState), visible: false } }, () => {
    resolve?.({ confirm, cancel: !confirm });
  });
}
