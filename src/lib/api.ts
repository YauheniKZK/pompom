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
const TOKEN_REQUIRED_PATHS = new Set([
  '/api/balance/debit',
  '/api/free-balance/topup',
  '/api/topup/invoice',
  '/api/topup/payments',
])

let appAuthToken: string | null = null
let refreshPromise: Promise<void> | null = null

export function getApiBaseUrlOrThrow(): string {
  if (!BASE_URL) {
    throw new ApiError('VITE_APP_REST_ENDPOINT is not configured', { retryable: false })
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
}

async function refreshAppAuthToken() {
  if (refreshPromise) {
    await refreshPromise
    return
  }

  refreshPromise = (async () => {
    let initData: string
    try {
      initData = getInitDataOrThrow()
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
  return error instanceof ApiError && error.status === 401 && error.detail === 'Invalid or expired app auth token'
}

async function fetchWithApiError(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new ApiError('Сетевая ошибка. Проверьте подключение и попробуйте снова.', {
      retryable: true,
    })
  }
}

async function executeRequest<TResponse>(
  path: string,
  init: RequestInit,
  withInitData: { asQuery?: QueryParams; asBody?: Record<string, unknown> },
  retryOnExpiredToken = true,
): Promise<TResponse> {
  const needsToken = shouldAttachAuthToken(path)
  if (needsToken && !appAuthToken) {
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
    initData = getInitDataOrThrow()
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
    if (retryOnExpiredToken && needsToken && isExpiredAuthTokenError(error)) {
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
  const detail = typeof data === 'object' && data && 'detail' in data ? String((data as { detail?: unknown }).detail ?? '') : ''
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
