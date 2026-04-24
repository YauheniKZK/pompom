import { getInitDataOrThrow } from './telegram'

type QueryValue = string | number | boolean | null | undefined
type QueryParams = Record<string, QueryValue>

export class ApiError extends Error {
  status?: number
  detail?: string
  retryable: boolean

  constructor(message: string, options?: { status?: number; detail?: string; retryable?: boolean }) {
    super(message)
    this.name = 'ApiError'
    this.status = options?.status
    this.detail = options?.detail
    this.retryable = Boolean(options?.retryable)
  }
}

const BASE_URL = String(import.meta.env.VITE_APP_REST_ENDPOINT ?? '').replace(/\/+$/, '')
const SESSION_OPEN_PATH = '/api/session/open'
const REQUEST_TIMEOUT_MS = 15000
const TOKEN_REQUIRED_PATHS = new Set([
  '/api/balance/debit',
  '/api/free-balance/topup',
  '/api/topup/invoice',
  '/api/topup/payments',
])

let appAuthToken: string | null = null
let appAuthTokenExpiresAtMs: number | null = null
let refreshPromise: Promise<void> | null = null

async function waitForInitDataOrThrow(timeoutMs = 2500, stepMs = 120): Promise<string> {
  const startedAt = Date.now()
  let lastError: unknown = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return getInitDataOrThrow()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, stepMs))
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new ApiError('Open this app inside Telegram Mini App', { retryable: false })
}

export function getApiBaseUrlOrThrow(): string {
  if (!BASE_URL) {
    throw new ApiError('VITE_APP_REST_ENDPOINT is not configured', { retryable: false })
  }
  let parsed: URL
  try {
    parsed = new URL(BASE_URL)
  } catch {
    throw new ApiError('VITE_APP_REST_ENDPOINT is invalid', { retryable: false })
  }
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !isLocalhost) {
    throw new ApiError('VITE_APP_REST_ENDPOINT must use HTTPS', { retryable: false })
  }
  return BASE_URL
}

function toSearchParams(params?: QueryParams): URLSearchParams {
  const search = new URLSearchParams()
  if (!params) return search
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  return search
}

function normalizeError(status: number, detail?: string): ApiError {
  if (status === 401) {
    return new ApiError('Откройте Mini App внутри Telegram', { status, detail, retryable: false })
  }
  if (status === 400) {
    return new ApiError(detail || 'Неверный пакет пополнения', { status, detail, retryable: false })
  }
  if (status === 403) {
    return new ApiError(detail || 'Доступ ограничен', { status, detail, retryable: false })
  }
  if (status === 429) {
    return new ApiError(detail || 'Слишком часто. Попробуйте чуть позже.', { status, detail, retryable: true })
  }
  if (status >= 500) {
    return new ApiError('Сервис временно недоступен, попробуйте позже', {
      status,
      detail,
      retryable: true,
    })
  }
  return new ApiError(detail || 'Request failed', { status, detail, retryable: false })
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function shouldAttachAuthToken(path: string): boolean {
  return TOKEN_REQUIRED_PATHS.has(normalizePath(path))
}

function getUrl(path: string, query?: string): string {
  const normalized = normalizePath(path)
  return `${getApiBaseUrlOrThrow()}${normalized}${query ? `?${query}` : ''}`
}

function setTokenFromResponse(data: unknown) {
  if (!data || typeof data !== 'object') return
  if (!('auth_token' in data)) return
  const token = String((data as { auth_token?: unknown }).auth_token ?? '').trim()
  appAuthToken = token || null
  const ttlSecondsRaw = Number((data as { auth_token_ttl_seconds?: unknown }).auth_token_ttl_seconds)
  if (appAuthToken && Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0) {
    appAuthTokenExpiresAtMs = Date.now() + ttlSecondsRaw * 1000
  } else {
    appAuthTokenExpiresAtMs = null
  }
}

async function refreshAppAuthToken() {
  if (refreshPromise) {
    await refreshPromise
    return
  }

  refreshPromise = (async () => {
    let initData: string
    try {
      initData = await waitForInitDataOrThrow()
    } catch {
      throw new ApiError('Open this app inside Telegram Mini App', { retryable: false })
    }

    let res: Response
    try {
      res = await fetch(getUrl(SESSION_OPEN_PATH), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: null, init_data: initData }),
      })
    } catch {
      throw new ApiError('Сетевая ошибка. Проверьте подключение и попробуйте снова.', {
        retryable: true,
      })
    }

    const data = await parseResponse<unknown>(res)
    setTokenFromResponse(data)
    if (!appAuthToken) {
      throw new ApiError('Missing app auth token in session/open response', {
        status: 401,
        retryable: false,
      })
    }
  })()

  try {
    await refreshPromise
  } finally {
    refreshPromise = null
  }
}

function isExpiredAuthTokenError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false
  const text = `${error.detail ?? ''} ${error.message}`.toLowerCase()
  return text.includes('app auth token') && (text.includes('invalid') || text.includes('expired'))
}

function isMissingAuthTokenError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false
  const text = `${error.detail ?? ''} ${error.message}`.toLowerCase()
  return text.includes('missing') && text.includes('x-app-auth-token')
}

function isInitDataHashError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false
  const text = `${error.detail ?? ''} ${error.message}`.toLowerCase()
  const hasInitDataMention = text.includes('initdata') || text.includes('init_data')
  const hasHashFailed = text.includes('hash') && text.includes('failed')
  const hasExpired = text.includes('expired') && text.includes('init')
  return hasInitDataMention && (hasHashFailed || hasExpired)
}

function clearAppAuthToken() {
  appAuthToken = null
  appAuthTokenExpiresAtMs = null
}

function isTokenExpiredOrNearExpiry() {
  if (!appAuthToken) return true
  if (!appAuthTokenExpiresAtMs) return false
  return Date.now() + 5000 >= appAuthTokenExpiresAtMs
}

async function fetchWithApiError(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Превышено время ожидания ответа сервера. Попробуйте снова.', {
        retryable: true,
      })
    }
    throw new ApiError('Сетевая ошибка. Проверьте подключение и попробуйте снова.', {
      retryable: true,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function executeRequest<TResponse>(
  path: string,
  init: RequestInit,
  withInitData: { asQuery?: QueryParams; asBody?: Record<string, unknown> },
  retryOnExpiredToken = true,
): Promise<TResponse> {
  const needsToken = shouldAttachAuthToken(path)
  if (needsToken && isTokenExpiredOrNearExpiry()) {
    await refreshAppAuthToken()
  }

  const headers = new Headers(init.headers)
  if (needsToken && appAuthToken) {
    headers.set('X-App-Auth-Token', appAuthToken)
  }

  let query = ''
  let body = init.body
  let initData: string
  try {
    initData = await waitForInitDataOrThrow()
  } catch {
    throw new ApiError('Open this app inside Telegram Mini App', { retryable: false })
  }

  if (withInitData.asQuery) {
    const search = toSearchParams(withInitData.asQuery)
    search.set('init_data', initData)
    query = search.toString()
  }

  if (withInitData.asBody) {
    body = JSON.stringify({ ...withInitData.asBody, init_data: initData })
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetchWithApiError(getUrl(path, query), {
    ...init,
    headers,
    body,
  })

  try {
    const data = await parseResponse<TResponse>(res)
    if (normalizePath(path) === SESSION_OPEN_PATH) {
      setTokenFromResponse(data as unknown)
    }
    return data
  } catch (error) {
    if (isInitDataHashError(error)) {
      clearAppAuthToken()
      throw new ApiError('Сессия Telegram истекла. Переоткройте Mini App.', {
        status: 401,
        detail: error instanceof ApiError ? error.detail : '',
        retryable: false,
      })
    }

    if (retryOnExpiredToken && needsToken && (isExpiredAuthTokenError(error) || isMissingAuthTokenError(error))) {
      clearAppAuthToken()
      await refreshAppAuthToken()
      return executeRequest<TResponse>(path, init, withInitData, false)
    }
    throw error
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      data = null
    }
  }
  if (res.ok) return data as T
  const detail =
    typeof data === 'object' && data
      ? String(
          (data as { detail?: unknown; message?: unknown; error?: unknown }).detail ??
            (data as { message?: unknown }).message ??
            (data as { error?: unknown }).error ??
            '',
        )
      : ''
  throw normalizeError(res.status, detail)
}

export async function apiPost<TResponse, TBody extends Record<string, unknown>>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  return executeRequest<TResponse>(
    path,
    { method: 'POST' },
    { asBody: body },
  )
}

export async function apiGet<TResponse>(path: string, params?: QueryParams): Promise<TResponse> {
  return executeRequest<TResponse>(
    path,
    { method: 'GET' },
    { asQuery: params },
  )
}
