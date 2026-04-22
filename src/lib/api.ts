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
  if (status === 403) {
    return new ApiError(detail || 'Доступ ограничен', { status, detail, retryable: false })
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
  let initData: string
  try {
    initData = getInitDataOrThrow()
  } catch {
    throw new ApiError('Open this app inside Telegram Mini App', { retryable: false })
  }

  const url = `${getApiBaseUrlOrThrow()}${path.startsWith('/') ? path : `/${path}`}`
  const payload = { ...body, init_data: initData }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new ApiError('Сетевая ошибка. Проверьте подключение и попробуйте снова.', {
      retryable: true,
    })
  }

  return parseResponse<TResponse>(res)
}

export async function apiGet<TResponse>(path: string, params?: QueryParams): Promise<TResponse> {
  let initData: string
  try {
    initData = getInitDataOrThrow()
  } catch {
    throw new ApiError('Open this app inside Telegram Mini App', { retryable: false })
  }

  const search = toSearchParams(params)
  search.set('init_data', initData)
  const query = search.toString()
  const url = `${getApiBaseUrlOrThrow()}${path.startsWith('/') ? path : `/${path}`}${query ? `?${query}` : ''}`

  let res: Response
  try {
    res = await fetch(url, { method: 'GET' })
  } catch {
    throw new ApiError('Сетевая ошибка. Проверьте подключение и попробуйте снова.', {
      retryable: true,
    })
  }

  return parseResponse<TResponse>(res)
}
