import * as d3 from 'd3'
import type { AppLocale } from '../i18n'

export type ImportedNameItem = {
  id: string
  name: string
  color: string
}

export type ImportedPeriodForm = {
  id: string
  period: string
  values: { name: string; value: number; period: string }[]
}

export type CsvImportOk = {
  ok: true
  names: ImportedNameItem[]
  periods: ImportedPeriodForm[]
}

export type CsvImportErr = {
  ok: false
  error: string
}

export type CsvImportResult = CsvImportOk | CsvImportErr

type CsvErrorKey =
  | 'emptyFile'
  | 'parseFailed'
  | 'noRows'
  | 'requiredColumns'
  | 'dateOrPeriod'
  | 'noValidRows'

const CSV_ERRORS: Record<AppLocale, Record<CsvErrorKey, string>> = {
  ru: {
    emptyFile: 'Файл пуст.',
    parseFailed: 'Не удалось разобрать CSV.',
    noRows: 'Нет строк данных (кроме заголовка).',
    requiredColumns: 'Нужны колонки name и value (или аналоги: label, value).',
    dateOrPeriod: 'Нужна колонка date (YYYY-MM-DD) или period.',
    noValidRows: 'Нет ни одной валидной строки (name, value, дата/период).',
  },
  en: {
    emptyFile: 'The file is empty.',
    parseFailed: 'Failed to parse CSV.',
    noRows: 'No data rows found (header only).',
    requiredColumns: 'Columns name and value are required (or aliases: label, value).',
    dateOrPeriod: 'Column date (YYYY-MM-DD) or period is required.',
    noValidRows: 'No valid rows found (name, value, date/period).',
  },
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function findColumn(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const keys = Object.keys(row)
  for (const c of candidates) {
    const hit = keys.find((k) => k.trim().toLowerCase() === c.toLowerCase())
    if (hit) return hit
  }
  return undefined
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function hashHue(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}

/**
 * Импорт CSV в форме D3 Bar Chart Race: date, name, value [, category].
 * Упрощённый формат: name, value, period (без date).
 */
export function importBarChartRaceCsv(csvText: string, locale: AppLocale = 'ru'): CsvImportResult {
  const l = locale === 'ru' ? 'ru' : 'en'
  const text = stripBom(csvText.trim())
  if (!text) return { ok: false, error: CSV_ERRORS[l].emptyFile }

  let rows: Record<string, unknown>[]
  try {
    rows = d3.csvParse(text, (raw) => raw as Record<string, unknown>)
  } catch {
    return { ok: false, error: CSV_ERRORS[l].parseFailed }
  }

  if (rows.length === 0) return { ok: false, error: CSV_ERRORS[l].noRows }

  const sample = rows[0]!
  const keyDate = findColumn(sample, ['date', 'дата', 'time'])
  const keyPeriod = findColumn(sample, ['period', 'период', 'year', 'год'])
  const keyName = findColumn(sample, ['name', 'имя', 'label', 'brand'])
  const keyValue = findColumn(sample, ['value', 'значение', 'val'])
  const keyCategory = findColumn(sample, ['category', 'категория', 'sector'])

  if (!keyName || !keyValue) {
    return {
      ok: false,
      error: CSV_ERRORS[l].requiredColumns,
    }
  }

  if (!keyDate && !keyPeriod) {
    return {
      ok: false,
      error: CSV_ERRORS[l].dateOrPeriod,
    }
  }

  type Norm = {
    periodLabel: string
    sortKey: number
    name: string
    value: number
    category?: string
  }

  const normalized: Norm[] = []
  /** Порядок периода при отсутствии date — по первому появлению в файле */
  const periodOrder = new Map<string, number>()
  let periodOrdinal = 0

  for (const raw of rows) {
    const name = String(raw[keyName] ?? '').trim()
    if (!name) continue

    const val = toNumber(raw[keyValue])
    if (val === null || val < 0) continue

    let periodLabel: string
    let sortKey: number

    if (keyDate && raw[keyDate] !== '' && raw[keyDate] !== undefined) {
      const d = raw[keyDate]
      const date =
        d instanceof Date
          ? d
          : typeof d === 'string' || typeof d === 'number'
            ? new Date(d)
            : null
      if (!date || Number.isNaN(+date)) continue
      periodLabel = String(date.getUTCFullYear())
      sortKey = +date
    } else {
      const p = String(raw[keyPeriod!] ?? '').trim()
      if (!p) continue
      periodLabel = p
      if (!periodOrder.has(periodLabel)) {
        periodOrder.set(periodLabel, periodOrdinal++)
      }
      sortKey = periodOrder.get(periodLabel)!
    }

    const catRaw = keyCategory ? raw[keyCategory] : undefined
    const category =
      catRaw !== undefined && catRaw !== null && String(catRaw).trim() !== ''
        ? String(catRaw).trim()
        : undefined

    normalized.push({ periodLabel, sortKey, name, value: val, category })
  }

  if (normalized.length === 0) {
    return { ok: false, error: CSV_ERRORS[l].noValidRows }
  }

  const byPeriodLabel = d3.group(normalized, (d) => d.periodLabel)
  const periodLabels = Array.from(byPeriodLabel.keys()).sort((a, b) => {
    const minA = d3.min(byPeriodLabel.get(a)!, (x) => x.sortKey) ?? 0
    const minB = d3.min(byPeriodLabel.get(b)!, (x) => x.sortKey) ?? 0
    return minA - minB
  })

  const uniqueNames = [...new Set(normalized.map((d) => d.name))].sort((x, y) =>
    x.localeCompare(y, undefined, { sensitivity: 'base' }),
  )

  const categoryByName = new Map<string, string>()
  for (const row of normalized) {
    if (row.category) categoryByName.set(row.name, row.category)
  }

  const categories = [...new Set(categoryByName.values())]
  const colorByCategory = d3.scaleOrdinal<string, string>(d3.schemeTableau10).domain(categories)

  const valueByPeriodName = new Map<string, Map<string, number>>()
  for (const row of normalized) {
    let m = valueByPeriodName.get(row.periodLabel)
    if (!m) {
      m = new Map()
      valueByPeriodName.set(row.periodLabel, m)
    }
    m.set(row.name, row.value)
  }

  const periods: ImportedPeriodForm[] = periodLabels.map((period) => {
    const m = valueByPeriodName.get(period) ?? new Map()
    return {
      id: crypto.randomUUID(),
      period,
      values: uniqueNames.map((name) => ({
        name,
        value: m.get(name) ?? 0,
        period,
      })),
    }
  })

  const names: ImportedNameItem[] = uniqueNames.map((name) => {
    const cat = categoryByName.get(name)
    const color =
      cat !== undefined && categories.length > 0
        ? colorByCategory(cat)
        : `hsl(${hashHue(name)} 65% 45%)`
    return { id: crypto.randomUUID(), name, color }
  })

  return { ok: true, names, periods }
}
