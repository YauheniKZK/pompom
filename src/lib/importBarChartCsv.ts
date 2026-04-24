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
  symbol?: string
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

function countDelimiter(line: string, delimiter: string) {
  return line.split(delimiter).length - 1
}

function detectDelimiter(line: string): ',' | ';' | '\t' {
  const candidates: Array<',' | ';' | '\t'> = [',', ';', '\t']
  let best: ',' | ';' | '\t' = ','
  let bestCount = -1
  for (const candidate of candidates) {
    const count = countDelimiter(line, candidate)
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

function preprocessCsvText(text: string) {
  const lines = text.split(/\r?\n/)
  const first = lines[0]?.trim() ?? ''
  const second = lines[1]?.trim() ?? ''
  const delimiter = detectDelimiter(second || first)
  const firstHasDelimiter = first.includes(delimiter)
  const secondHasDelimiter = second.includes(delimiter)
  const shouldDropFirstLine = Boolean(first && !firstHasDelimiter && secondHasDelimiter)
  const normalizedText = shouldDropFirstLine ? lines.slice(1).join('\n') : text
  return { normalizedText, delimiter, shouldDropFirstLine, first, second }
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
  const raw = String(v).trim()
  const tokenMatch = raw.match(/[-+]?\d[\d\s.,]*/)
  if (!tokenMatch) return null

  let token = tokenMatch[0].replace(/\s+/g, '')
  const commaCount = (token.match(/,/g) ?? []).length
  const dotCount = (token.match(/\./g) ?? []).length

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = token.lastIndexOf(',')
    const lastDot = token.lastIndexOf('.')
    if (lastComma > lastDot) {
      token = token.replace(/\./g, '').replace(',', '.')
    } else {
      token = token.replace(/,/g, '')
    }
  } else if (commaCount > 0) {
    if (commaCount > 1) {
      token = token.replace(/,/g, '')
    } else {
      const fractionLen = token.length - token.lastIndexOf(',') - 1
      token = fractionLen >= 1 && fractionLen <= 2 ? token.replace(',', '.') : token.replace(/,/g, '')
    }
  } else if (dotCount > 0) {
    if (dotCount > 1) {
      token = token.replace(/\./g, '')
    } else {
      const fractionLen = token.length - token.lastIndexOf('.') - 1
      if (fractionLen !== 3) {
        // Single dot is likely decimal separator (e.g. 12.34)
      } else {
        token = token.replace(/\./g, '')
      }
    }
  }

  const n = Number(token)
  return Number.isFinite(n) ? n : null
}

function extractValueQualifier(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const raw = String(v).trim()
  if (!raw) return null
  const tokenMatch = raw.match(/[-+]?\d[\d\s.,]*/)
  if (!tokenMatch || tokenMatch.index === undefined) return null
  const prefix = raw.slice(0, tokenMatch.index).trim()
  const suffix = raw.slice(tokenMatch.index + tokenMatch[0].length).trim()
  const label = [prefix, suffix].filter(Boolean).join(' ').trim()
  return label || null
}

function createUtcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < 1000 || year > 3000) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  const wholeDays = Math.floor(serial)
  const msPerDay = 24 * 60 * 60 * 1000
  // Excel serial day 1 = 1900-01-01; compensate leap-year bug around 1900-02-29
  const excelEpochUtcMs = Date.UTC(1899, 11, 30)
  const leapBugOffset = wholeDays >= 60 ? -1 : 0
  const date = new Date(excelEpochUtcMs + (wholeDays + leapBugOffset) * msPerDay)
  return Number.isNaN(+date) ? null : date
}

function parseDateValue(v: unknown): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(+v) ? null : v
  }

  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) {
      const date = new Date(v)
      return Number.isNaN(+date) ? null : date
    }
    if (v > 1e9) {
      const date = new Date(v * 1000)
      return Number.isNaN(+date) ? null : date
    }
    if (v >= 1000 && v <= 3000 && Number.isInteger(v)) {
      return createUtcDate(v, 1, 1)
    }
    const excelDate = excelSerialToDate(v)
    if (excelDate) return excelDate
    return null
  }

  if (typeof v !== 'string') return null
  const s = v.trim().replace(/^["']|["']$/g, '')
  if (!s) return null

  if (/^\d{4}$/.test(s)) {
    return createUtcDate(Number(s), 1, 1)
  }

  const yearMonth = s.match(/^(\d{4})[./-](\d{1,2})$/)
  if (yearMonth) {
    return createUtcDate(Number(yearMonth[1]), Number(yearMonth[2]), 1)
  }

  const ymd = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)
  if (ymd) {
    return createUtcDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
  }

  const dmyOrMdy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (dmyOrMdy) {
    const a = Number(dmyOrMdy[1])
    const b = Number(dmyOrMdy[2])
    const yRaw = Number(dmyOrMdy[3])
    const y = yRaw < 100 ? 2000 + yRaw : yRaw
    if (a > 12 && b <= 12) return createUtcDate(y, b, a)
    if (b > 12 && a <= 12) return createUtcDate(y, a, b)
    return createUtcDate(y, b, a)
  }

  const ts = Date.parse(s)
  if (!Number.isNaN(ts)) {
    const date = new Date(ts)
    return Number.isNaN(+date) ? null : date
  }

  return null
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
  const {
    normalizedText,
    delimiter,
    shouldDropFirstLine,
    first,
    second,
  } = preprocessCsvText(text)
  console.info('[csv-import] raw text preview', {
    length: text.length,
    preview: text.slice(0, 500),
    delimiter,
    skippedFirstLine: shouldDropFirstLine,
    firstLine: first,
    secondLine: second,
  })
  if (!text) return { ok: false, error: CSV_ERRORS[l].emptyFile }

  let rows: Record<string, unknown>[]
  try {
    rows = d3.dsvFormat(delimiter).parse(normalizedText, (raw) => raw as Record<string, unknown>)
  } catch {
    return { ok: false, error: CSV_ERRORS[l].parseFailed }
  }
  console.info('[csv-import] parsed rows', {
    count: rows.length,
    firstRows: rows.slice(0, 5),
  })

  if (rows.length === 0) return { ok: false, error: CSV_ERRORS[l].noRows }

  const sample = rows[0]!
  const keyDate = findColumn(sample, ['date', 'дата', 'time'])
  const keyPeriod = findColumn(sample, ['period', 'период', 'year', 'год'])
  const keyName = findColumn(sample, ['name', 'имя', 'label', 'brand'])
  const keyValue = findColumn(sample, ['value', 'значение', 'val'])
  const keySymbol = findColumn(sample, ['symbol', 'символ', 'currency', 'валюта'])
  const keyCategory = findColumn(sample, ['category', 'категория', 'sector'])
  console.info('[csv-import] detected columns', {
    keyDate,
    keyPeriod,
    keyName,
    keyValue,
    keySymbol,
    keyCategory,
  })

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
  const valueQualifiers = new Set<string>()
  let detectedSymbol: string | undefined
  /** Порядок периода при отсутствии date — по первому появлению в файле */
  const periodOrder = new Map<string, number>()
  let periodOrdinal = 0

  for (const raw of rows) {
    const name = String(raw[keyName] ?? '').trim()
    if (!name) continue

    const val = toNumber(raw[keyValue])
    if (val === null || val < 0) continue
    const qualifier = extractValueQualifier(raw[keyValue])
    if (qualifier) valueQualifiers.add(qualifier)
    if (!detectedSymbol && keySymbol) {
      const maybeSymbol = String(raw[keySymbol] ?? '').trim()
      if (maybeSymbol) detectedSymbol = maybeSymbol
    }

    let periodLabel: string
    let sortKey: number

    if (keyDate && raw[keyDate] !== '' && raw[keyDate] !== undefined) {
      const date = parseDateValue(raw[keyDate])
      if (!date) continue
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
  console.info('[csv-import] normalized rows', {
    count: normalized.length,
    firstRows: normalized.slice(0, 5),
  })

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
  console.info('[csv-import] result summary', {
    namesCount: names.length,
    periodsCount: periods.length,
    firstPeriod: periods[0]?.period ?? null,
    valueQualifiers: Array.from(valueQualifiers),
  })

  return { ok: true, names, periods, symbol: detectedSymbol }
}
