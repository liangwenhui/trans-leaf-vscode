/**
 * 全局翻译锁
 * 用于防止并发翻译操作
 */
let isTranslating = false;

export function acquireLock(): boolean {
  if (isTranslating) {
    return false;
  }
  isTranslating = true;
  return true;
}

export function releaseLock(): void {
  isTranslating = false;
}

export function isLocked(): boolean {
  return isTranslating;
}
