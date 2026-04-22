export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending'

type TelegramWebAppLike = {
  initData?: string
  ready?: () => void
  expand?: () => void
  openInvoice?: (url: string, callback?: (status: InvoiceStatus) => void) => void
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppLike
    }
  }
}

export function getTelegramWebAppOrThrow(): TelegramWebAppLike {
  const webApp = window.Telegram?.WebApp
  if (!webApp) {
    throw new Error('Open this app inside Telegram Mini App')
  }
  return webApp
}

export function getInitDataOrThrow(): string {
  const webApp = getTelegramWebAppOrThrow()
  const initData = String(webApp.initData ?? '').trim()
  if (!initData) {
    throw new Error('Open this app inside Telegram Mini App')
  }
  return initData
}

export function readyAndExpand() {
  const webApp = getTelegramWebAppOrThrow()
  webApp.ready?.()
  webApp.expand?.()
}

export function openInvoice(link: string): Promise<InvoiceStatus> {
  const webApp = getTelegramWebAppOrThrow()
  const openInvoiceFn = webApp.openInvoice
  if (!link) return Promise.resolve('failed')
  if (!openInvoiceFn) return Promise.resolve('failed')

  return new Promise<InvoiceStatus>((resolve) => {
    let settled = false
    const done = (status: InvoiceStatus) => {
      if (settled) return
      settled = true
      resolve(status)
    }

    try {
      openInvoiceFn(link, (status) => {
        if (status === 'paid' || status === 'cancelled' || status === 'failed' || status === 'pending') {
          done(status)
          return
        }
        done('failed')
      })
    } catch {
      done('failed')
    }

    window.setTimeout(() => done('pending'), 20000)
  })
}
