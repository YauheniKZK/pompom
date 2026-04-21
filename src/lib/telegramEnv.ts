import WebApp from '@twa-dev/sdk'

export type WindowWithTg = Window & { TelegramWebviewProxy?: unknown }

/** Параметры Mini App в URL (# / query) — если редирект «съел» hash, SDK может быть пустым */
export function hasTelegramWebAppInLocation(): boolean {
  if (typeof window === 'undefined') return false
  const { hash, search } = window.location
  const s = `${hash}${search}`
  if (!s) return false
  return /tgWebApp(?:Data|Platform|Version|BotId|ThemeParams|StartParam|Fullscreen)/i.test(s)
}

/** Нативный клиент Telegram встраивает мост до WebView */
export function hasNativeTelegramBridge(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as WindowWithTg).TelegramWebviewProxy !== 'undefined'
}

export function isLikelyTelegramUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Telegram/i.test(navigator.userAgent)
}

export function isSdkTelegramWebApp(): boolean {
  const data = WebApp.initData
  if (typeof data === 'string' && data.length > 0) return true
  if (WebApp.platform && WebApp.platform !== 'unknown') return true
  const unsafe = WebApp.initDataUnsafe
  if (unsafe && typeof unsafe === 'object') {
    if ('user' in unsafe || 'auth_date' in unsafe || 'hash' in unsafe) return true
  }
  return false
}

/** Полное определение Mini App (совпадает с логикой экрана в App.vue) */
export function isTelegramMiniAppEnvironment(): boolean {
  if (isSdkTelegramWebApp()) return true
  if (hasTelegramWebAppInLocation()) return true
  if (hasNativeTelegramBridge()) return true
  if (isLikelyTelegramUserAgent()) return true
  return false
}
