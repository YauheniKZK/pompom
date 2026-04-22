<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WebApp from '@twa-dev/sdk'
import * as d3 from 'd3'
import { useI18n } from 'vue-i18n'
import { isTelegramMiniAppEnvironment } from './lib/telegramEnv'
import {
  allNames,
  buildKeyframes,
  createExplainedContext,
  datevalues,
  periodLabelForKeyframeDate,
  rankFactory,
  renderExplainedFrame,
  sortedPeriodsFromRaw,
  type ExplainedChartOptions,
  type RawRaceRow,
} from './lib/barChartRaceExplained'
import { importBarChartRaceCsv } from './lib/importBarChartCsv'
import { persistLocale, type AppLocale } from './i18n'
import { ApiError, apiGet, apiPost, getApiBaseUrlOrThrow } from './lib/api'
import { openInvoice, type InvoiceStatus, readyAndExpand } from './lib/telegram'

type RawDataItem = {
  name: string
  value: number
  period: string
}

type LabelLayoutMode = 'mode1' | 'mode2' | 'mode3' | 'mode4'

type NameItem = {
  id: string
  name: string
  color: string
}

type PeriodForm = {
  id: string
  period: string
  values: RawDataItem[]
}

type ChartRenderSettings = {
  labelLayoutMode: LabelLayoutMode
  labelColor: string
}

type BackendProfile = {
  id: number
  title?: string
}

type SessionOpenResponse = {
  user: {
    id?: number | string
    balance?: number | string
    free_balance?: number | string
  } | null
  limits: Record<string, unknown> | null
  profiles: BackendProfile[]
  active_profile: BackendProfile | null
}

type TopupPackage = {
  units: number
  stars: number
}

type TopupPackagesResponse = TopupPackage[] | { items?: TopupPackage[]; packages?: TopupPackage[] }

type TopupInvoiceResponse = {
  invoice_link: string
}

type TopupPayment = {
  id?: number | string
  status?: string
  units?: number
  stars?: number
  target_field?: 'balance' | 'free_balance' | string
  created_at?: string
}

const { t, locale } = useI18n({ useScope: 'global' })

function setLocale(next: AppLocale) {
  locale.value = next
  persistLocale(next)
}

const chartTitle = ref(t('chart.defaultTitle'))
const chartDescription = ref(t('chart.defaultDescription'))
const labelLayoutMode = ref<LabelLayoutMode>('mode3')
const BAR_HEIGHT_PX = 50
const NAME_FONT_SIZE_PX = 13
const VALUE_FONT_SIZE_PX = 13
const names = ref<NameItem[]>([
  { id: crypto.randomUUID(), name: 'Product A', color: '#1d4ed8' },
  { id: crypto.randomUUID(), name: 'Product B', color: '#dc2626' },
  { id: crypto.randomUUID(), name: 'Product C', color: '#059669' },
  { id: crypto.randomUUID(), name: 'Product D', color: '#7c3aed' },
  { id: crypto.randomUUID(), name: 'Product E', color: '#ea580c' },
  { id: crypto.randomUUID(), name: 'Product F', color: '#0f766e' },
])
const newNameText = ref('')
const periods = ref<PeriodForm[]>([
  {
    id: crypto.randomUUID(),
    period: '2019',
    values: [
      { name: 'Product A', value: 18, period: '2019' },
      { name: 'Product B', value: 28, period: '2019' },
      { name: 'Product C', value: 14, period: '2019' },
      { name: 'Product D', value: 22, period: '2019' },
      { name: 'Product E', value: 16, period: '2019' },
      { name: 'Product F', value: 11, period: '2019' },
    ],
  },
  {
    id: crypto.randomUUID(),
    period: '2020',
    values: [
      { name: 'Product A', value: 27, period: '2020' },
      { name: 'Product B', value: 33, period: '2020' },
      { name: 'Product C', value: 19, period: '2020' },
      { name: 'Product D', value: 29, period: '2020' },
      { name: 'Product E', value: 24, period: '2020' },
      { name: 'Product F', value: 17, period: '2020' },
    ],
  },
  {
    id: crypto.randomUUID(),
    period: '2021',
    values: [
      { name: 'Product A', value: 30, period: '2021' },
      { name: 'Product B', value: 45, period: '2021' },
      { name: 'Product C', value: 21, period: '2021' },
      { name: 'Product D', value: 36, period: '2021' },
      { name: 'Product E', value: 31, period: '2021' },
      { name: 'Product F', value: 23, period: '2021' },
    ],
  },
  {
    id: crypto.randomUUID(),
    period: '2022',
    values: [
      { name: 'Product A', value: 54, period: '2022' },
      { name: 'Product B', value: 36, period: '2022' },
      { name: 'Product C', value: 42, period: '2022' },
      { name: 'Product D', value: 47, period: '2022' },
      { name: 'Product E', value: 40, period: '2022' },
      { name: 'Product F', value: 28, period: '2022' },
    ],
  },
  {
    id: crypto.randomUUID(),
    period: '2023',
    values: [
      { name: 'Product A', value: 66, period: '2023' },
      { name: 'Product B', value: 48, period: '2023' },
      { name: 'Product C', value: 60, period: '2023' },
      { name: 'Product D', value: 58, period: '2023' },
      { name: 'Product E', value: 52, period: '2023' },
      { name: 'Product F', value: 39, period: '2023' },
    ],
  },
])
const selectedPeriodId = ref<string>(periods.value[0]?.id ?? '')
const newPeriodText = ref('')

const svgRef = ref<SVGSVGElement | null>(null)
/** SVG в полноэкранной панели на узких экранах (< lg) */
const svgRefMobile = ref<SVGSVGElement | null>(null)
const csvFileInput = ref<HTMLInputElement | null>(null)
/** Совпадает с Tailwind `lg:` (1024px): мобильная раскладка графика */
const isMobileLayout = ref(
  typeof window !== 'undefined' ? window.innerWidth < 1024 : false,
)
const chartPanelOpen = ref(false)
const errorMessage = ref('')
const endpointMissing = ref(false)
const bootstrapLoading = ref(false)
const bootstrapError = ref('')
const sessionData = ref<SessionOpenResponse | null>(null)
const topupPackages = ref<TopupPackage[]>([])
const topupPayments = ref<TopupPayment[]>([])
const topupPackagesLoading = ref(false)
const topupActionLoading = ref(false)
const topupPaymentsLoading = ref(false)
const topupError = ref('')
const topupStatus = ref<'idle' | InvoiceStatus>('idle')
const countdown = ref<number | null>(null)
const isAnimating = ref(false)
const viewportHeightCss = ref('100dvh')
const telegramTopInsetPx = ref(0)
const telegramBottomInsetPx = ref(0)
const tgTopInsetCss = 'calc(var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px))'
const tgBottomInsetCss =
  'calc(var(--tg-safe-area-inset-bottom, 0px) + var(--tg-content-safe-area-inset-bottom, 0px))'

const mainContainerStyle = computed(() => ({
  minHeight: viewportHeightCss.value,
  paddingTop: `max(0.75rem, env(safe-area-inset-top), ${tgTopInsetCss}, ${telegramTopInsetPx.value}px)`,
  paddingBottom: `max(5rem, env(safe-area-inset-bottom), ${tgBottomInsetCss}, ${telegramBottomInsetPx.value}px)`,
  paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
  paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
}))

const mobileFabStyle = computed(() => ({
  bottom: `calc(max(0.75rem, env(safe-area-inset-bottom), ${tgBottomInsetCss}, ${telegramBottomInsetPx.value}px) + 10px)`,
  right: 'calc(max(0.75rem, env(safe-area-inset-right)) + 6px)',
}))

const mobilePanelHeaderStyle = computed(() => ({
  paddingTop: `max(0.5rem, env(safe-area-inset-top), ${tgTopInsetCss}, ${telegramTopInsetPx.value}px)`,
}))

const mobilePanelBodyStyle = computed(() => ({
  paddingBottom: `max(4.75rem, env(safe-area-inset-bottom), ${tgBottomInsetCss}, ${telegramBottomInsetPx.value + 8}px)`,
}))

const mobilePanelFloatsStyle = computed(() => ({
  bottom: `calc(max(0.5rem, env(safe-area-inset-bottom), ${tgBottomInsetCss}, ${telegramBottomInsetPx.value}px) + 10px)`,
  right: 'calc(max(0.5rem, env(safe-area-inset-right)) + 6px)',
}))

let startTimeout: number | null = null
let countdownInterval: number | null = null
let postRaceFloatTimer: number | null = null

function mapApiError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof ApiError) {
    return { message: error.message, retryable: error.retryable }
  }
  if (error instanceof Error) {
    return { message: error.message, retryable: false }
  }
  return { message: 'Неизвестная ошибка', retryable: false }
}

async function loadSession() {
  bootstrapLoading.value = true
  bootstrapError.value = ''
  try {
    readyAndExpand()
    const data = await apiPost<SessionOpenResponse, { profile_id: null }>('/api/session/open', {
      profile_id: null,
    })
    sessionData.value = data
  } catch (error) {
    const normalized = mapApiError(error)
    bootstrapError.value = normalized.message
  } finally {
    bootstrapLoading.value = false
  }
}

async function loadTopupPackages() {
  topupPackagesLoading.value = true
  topupError.value = ''
  try {
    const data = await apiGet<TopupPackagesResponse>('/api/topup/packages')
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.packages)
        ? data.packages
        : Array.isArray(data?.items)
          ? data.items
          : []
    const normalized = list
      .map((item) => ({
        units: Number(item.units),
        stars: Number(item.stars),
      }))
      .filter((item) => Number.isFinite(item.units) && item.units > 0 && Number.isFinite(item.stars) && item.stars > 0)
    topupPackages.value = normalized
  } catch (error) {
    topupError.value = mapApiError(error).message
  } finally {
    topupPackagesLoading.value = false
  }
}

async function loadTopupPayments(limit = 20) {
  topupPaymentsLoading.value = true
  try {
    const data = await apiGet<TopupPayment[]>('/api/topup/payments', { limit })
    topupPayments.value = Array.isArray(data) ? data : []
  } catch (error) {
    topupError.value = mapApiError(error).message
  } finally {
    topupPaymentsLoading.value = false
  }
}

async function buyTopup(pkg: TopupPackage) {
  topupActionLoading.value = true
  topupError.value = ''
  topupStatus.value = 'pending'
  try {
    const invoice = await apiPost<TopupInvoiceResponse, { units: number; target_field: 'balance' }>(
      '/api/topup/invoice',
      {
        units: pkg.units,
        target_field: 'balance',
      },
    )
    const status = await openInvoice(invoice.invoice_link)
    topupStatus.value = status
    await loadSession()
    await loadTopupPayments(20)
  } catch (error) {
    topupStatus.value = 'failed'
    topupError.value = mapApiError(error).message
  } finally {
    topupActionLoading.value = false
  }
}

function syncTelegramViewportInsets() {
  try {
    const app = WebApp as unknown as {
      viewportHeight?: number
      viewportStableHeight?: number
      safeAreaInset?: { top?: number; bottom?: number }
      contentSafeAreaInset?: { top?: number; bottom?: number }
      safe_area_inset?: { top?: number; bottom?: number }
      content_safe_area_inset?: { top?: number; bottom?: number }
    }
    const stableH = Number(app.viewportStableHeight)
    const currentH = Number(app.viewportHeight)
    const h = Number.isFinite(stableH) && stableH > 0 ? stableH : currentH
    viewportHeightCss.value = Number.isFinite(h) && h > 0 ? `${Math.round(h)}px` : '100dvh'

    const safe = app.safeAreaInset ?? app.safe_area_inset ?? {}
    const content = app.contentSafeAreaInset ?? app.content_safe_area_inset ?? {}
    telegramTopInsetPx.value = Math.max(0, Number(safe.top ?? 0) + Number(content.top ?? 0))
    telegramBottomInsetPx.value = Math.max(
      0,
      Number(safe.bottom ?? 0) + Number(content.bottom ?? 0),
    )
  } catch {
    viewportHeightCss.value = '100dvh'
    telegramTopInsetPx.value = 0
    telegramBottomInsetPx.value = 0
  }
}

/** Play, Закрыть (моб. панель), FAB — скрываем на отсчёте и во время анимации */
const showChartPlay = computed(() => countdown.value === null && !isAnimating.value)
/** После окончания гонки ждём 1 с, затем показываем float-кнопки и FAB на мобиле */
const mobileFloatActionsReady = ref(true)

const showMobileChartFloats = computed(
  () => showChartPlay.value && mobileFloatActionsReady.value,
)
const generationsDrawerOpen = ref(false)
const availableGenerations = computed(() => {
  const paid = Number(sessionData.value?.user?.balance ?? 0)
  const free = Number(sessionData.value?.user?.free_balance ?? 0)
  const total = (Number.isFinite(paid) ? paid : 0) + (Number.isFinite(free) ? free : 0)
  return total >= 0 ? Math.floor(total) : 0
})

const isAdminUser = computed(() => {
  const rawAdmins = String(import.meta.env.VITE_APP_ADMINS_IDS ?? '').trim()
  if (!rawAdmins) return false
  const userId = String(sessionData.value?.user?.id ?? '').trim()
  if (!userId) return false
  const adminIds = rawAdmins
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return adminIds.includes(userId)
})

const visibleTopupPackages = computed(() => {
  if (isAdminUser.value) return topupPackages.value
  return topupPackages.value.filter((pack) => !(pack.units === 1 && pack.stars === 1))
})

const paidBalance = computed(() => {
  const value = Number(sessionData.value?.user?.balance ?? 0)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
})

const freeBalance = computed(() => {
  const value = Number(sessionData.value?.user?.free_balance ?? 0)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
})

function generationAmountLabel(amount: number): string {
  if (locale.value === 'ru') {
    const mod10 = amount % 10
    const mod100 = amount % 100
    if (mod10 === 1 && mod100 !== 11) return `${amount} ${t('chart.generationUnitOne')}`
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${amount} ${t('chart.generationUnitFew')}`
    }
    return `${amount} ${t('chart.generationUnitMany')}`
  }

  return `${amount} ${amount === 1 ? t('chart.generationUnitOne') : t('chart.generationUnitMany')}`
}
const playReminderOpen = ref(false)
const pendingPlayData = ref<RawDataItem[] | null>(null)
const hasValidChartTitle = computed(() => chartTitle.value.trim().length > 0)
const hasMinimumItems = computed(() => names.value.length >= 2)
const playDisabledReason = computed(() => {
  if (!hasValidChartTitle.value) return t('chart.playDisabledTitleRequired')
  if (!hasMinimumItems.value) return t('chart.playDisabledNeedTwoItems')
  return ''
})
const canStartPlay = computed(() => playDisabledReason.value.length === 0)

/** Родная «Назад» в шапке Mini App (web_app_setup_back_button с 6.1) */
function canUseTelegramNativeBackButton(): boolean {
  try {
    return isTelegramMiniAppEnvironment() && WebApp.isVersionAtLeast('6.1')
  } catch {
    return false
  }
}

const showCustomPanelCloseButton = computed(() => !canUseTelegramNativeBackButton())

function onTelegramBackClosePanel() {
  closeChartPanel()
}

function syncTelegramBackButton() {
  try {
    WebApp.BackButton.offClick(onTelegramBackClosePanel)
    /** В Mini App всегда пробуем show (SDK внутри проверит версию ≥ 6.1); не требовать 6.1 здесь — иначе при сбое tgWebAppVersion кнопка не появлялась */
    const show =
      isTelegramMiniAppEnvironment() &&
      isMobileLayout.value &&
      chartPanelOpen.value
    if (show) {
      try {
        WebApp.ready()
      } catch {
        /* no-op */
      }
      WebApp.BackButton.show()
      WebApp.BackButton.onClick(onTelegramBackClosePanel)
    } else {
      WebApp.BackButton.hide()
    }
  } catch {
    /* вне Telegram или старый клиент */
  }
}

/** После открытия панели шапка Mini App иногда дорисовывается со сдвигом — повторяем show */
function scheduleSyncTelegramBackButton() {
  syncTelegramBackButton()
  void nextTick(() => {
    requestAnimationFrame(() => {
      syncTelegramBackButton()
      setTimeout(syncTelegramBackButton, 48)
      setTimeout(syncTelegramBackButton, 160)
      setTimeout(syncTelegramBackButton, 400)
    })
  })
}
const selectedPeriod = computed(() =>
  periods.value.find((period) => period.id === selectedPeriodId.value),
)

const getNameByName = (name: string) => names.value.find((item) => item.name === name)
const getBarColor = (name: string) => getNameByName(name)?.color ?? '#64748b'

const randomColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`

const getCurrentSettings = (): ChartRenderSettings => ({
  labelLayoutMode: labelLayoutMode.value,
  labelColor: '#334155',
})

const resolveChartSvgEl = (): SVGSVGElement | null => {
  if (isMobileLayout.value) {
    return chartPanelOpen.value ? svgRefMobile.value : null
  }
  return svgRef.value
}

const syncMobileLayout = () => {
  const next = typeof window !== 'undefined' && window.innerWidth < 1024
  if (isMobileLayout.value !== next) {
    isMobileLayout.value = next
    if (!next) chartPanelOpen.value = false
  }
}

const getChartDimensions = () => {
  const containerWidth = resolveChartSvgEl()?.clientWidth ?? 860
  return {
    width: Math.max(320, containerWidth),
    height: 500,
  }
}

const openChartPanel = () => {
  chartPanelOpen.value = true
  scheduleSyncTelegramBackButton()
}

const closeChartPanel = () => {
  chartPanelOpen.value = false
}

const onChartPanelKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && chartPanelOpen.value && isMobileLayout.value) {
    closeChartPanel()
  }
}

/** Как в Observable «Bar Chart Race, Explained»: верхняя ось, подписи у правого края бара, тикер */
const explainedMargin = { top: 16, right: 6, bottom: 6, left: 0 }
const keyframeSteps = 10
const explainedDurationMs = 250

let raceGeneration = 0

const addName = () => {
  const name = newNameText.value.trim()
  if (!name) {
    errorMessage.value = t('chart.errors.enterItem')
    return
  }

  const exists = names.value.some((item) => item.name === name)
  if (exists) {
    errorMessage.value = t('chart.errors.duplicateItem')
    return
  }

  names.value.push({ id: crypto.randomUUID(), name, color: randomColor() })
  for (const periodItem of periods.value) {
    periodItem.values.push({ name, value: 0, period: periodItem.period })
  }
  newNameText.value = ''
  errorMessage.value = ''
}

const removeName = (nameId: string) => {
  const removed = names.value.find((item) => item.id === nameId)
  if (!removed) return
  names.value = names.value.filter((item) => item.id !== nameId)
  for (const periodItem of periods.value) {
    periodItem.values = periodItem.values.filter((value) => value.name !== removed.name)
  }
}

const selectPeriod = (periodId: string) => {
  selectedPeriodId.value = periodId
}

const addPeriod = () => {
  const period = newPeriodText.value.trim()
  if (!period) {
    errorMessage.value = t('chart.errors.enterPeriod')
    return
  }

  const exists = periods.value.some((item) => item.period === period)
  if (exists) {
    errorMessage.value = t('chart.errors.duplicatePeriod')
    return
  }

  const periodItem: PeriodForm = {
    id: crypto.randomUUID(),
    period,
    values: names.value.map((item) => ({
      name: item.name,
      value: 0,
      period,
    })),
  }

  periods.value.push(periodItem)
  selectedPeriodId.value = periodItem.id
  newPeriodText.value = ''
  errorMessage.value = ''
}

const removePeriod = (periodId: string) => {
  periods.value = periods.value.filter((period) => period.id !== periodId)
  if (selectedPeriodId.value === periodId) {
    selectedPeriodId.value = periods.value[0]?.id ?? ''
  }
}

const clearAllSampleData = () => {
  names.value = []
  periods.value = []
  selectedPeriodId.value = ''
  errorMessage.value = ''
}

const triggerCsvPick = () => {
  csvFileInput.value?.click()
}

const onCsvFile = (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result ?? '')
    const res = importBarChartRaceCsv(text, locale.value === 'ru' ? 'ru' : 'en')
    if (!res.ok) {
      errorMessage.value = res.error
      return
    }
    names.value = res.names.map((item) => ({ ...item }))
    periods.value = res.periods.map((p) => ({
      ...p,
      values: p.values.map((v) => ({ ...v })),
    }))
    selectedPeriodId.value = periods.value[0]?.id ?? ''
    errorMessage.value = ''
    raceGeneration += 1
    if (window.innerWidth < 1024) chartPanelOpen.value = true
    void nextTick(() => {
      if (!isAnimating.value && countdown.value === null) {
        renderPreviewChart(collectDataForPreview())
      }
    })
  }
  reader.onerror = () => {
    errorMessage.value = t('chart.errors.readFile')
  }
  reader.readAsText(file, 'UTF-8')
}

const clearTimers = () => {
  if (startTimeout !== null) {
    window.clearTimeout(startTimeout)
    startTimeout = null
  }
  if (countdownInterval !== null) {
    window.clearInterval(countdownInterval)
    countdownInterval = null
  }
  if (postRaceFloatTimer !== null) {
    window.clearTimeout(postRaceFloatTimer)
    postRaceFloatTimer = null
  }
  countdown.value = null
}

const collectDataFromForm = (): RawDataItem[] | null => {
  if (periods.value.length === 0) {
    errorMessage.value = t('chart.errors.addPeriod')
    return null
  }
  if (names.value.length === 0) {
    errorMessage.value = t('chart.errors.addItem')
    return null
  }

  const normalized: RawDataItem[] = []
  for (const periodItem of periods.value) {
    const period = periodItem.period.trim()
    if (!period) {
      errorMessage.value = t('chart.errors.periodNameRequired')
      return null
    }

    if (periodItem.values.length !== names.value.length) {
      errorMessage.value = t('chart.errors.periodMissingItems', { period })
      return null
    }

    for (const valueItem of periodItem.values) {
      const name = valueItem.name.trim()
      const value = Number(valueItem.value)
      const isInvalid = !name || Number.isNaN(value) || !Number.isFinite(value) || value < 0
      if (isInvalid) {
        errorMessage.value = t('chart.errors.periodInvalidValues', { period })
        return null
      }
      normalized.push({ name, value, period })
    }
  }

  errorMessage.value = ''
  return normalized
}

const collectDataForPreview = (): RawDataItem[] => {
  const normalized: RawDataItem[] = []

  for (const periodItem of periods.value) {
    const period = periodItem.period.trim()
    if (!period) continue

    for (const valueItem of periodItem.values) {
      const name = valueItem.name.trim()
      const value = Number(valueItem.value)
      if (!name || Number.isNaN(value) || !Number.isFinite(value) || value < 0) continue
      normalized.push({ name, value, period })
    }
  }

  return normalized
}

const renderPreviewChart = (rawData: RawDataItem[]) => {
  const svgEl = resolveChartSvgEl()
  if (!svgEl) return
  const raw = rawData as RawRaceRow[]
  if (raw.length === 0) return

  const periodsOrdered = sortedPeriodsFromRaw(raw)
  if (periodsOrdered.length === 0) return

  const dv = datevalues(raw, periodsOrdered)
  const namesSet = allNames(raw)
  const topN = Math.min(12, Math.max(1, namesSet.size))
  const rank = rankFactory(namesSet, topN)
  const keyframes = buildKeyframes(dv, keyframeSteps, rank)
  if (keyframes.length === 0) return

  const { width } = getChartDimensions()
  const options: ExplainedChartOptions = {
    width,
    topN,
    barSize: BAR_HEIGHT_PX,
    durationMs: explainedDurationMs,
    keyframeSteps,
    margin: explainedMargin,
    color: getBarColor,
    labelFill: '#334155',
    labelLayoutMode: labelLayoutMode.value,
    valueFontSizePx: VALUE_FONT_SIZE_PX,
  }
  const labelFont = `bold ${NAME_FONT_SIZE_PX}px var(--sans-serif, ui-sans-serif, system-ui, sans-serif)`

  const ctx = createExplainedContext(svgEl, keyframes, periodsOrdered, options, labelFont)
  if (!ctx) return

  const first = keyframes[0]!
  const tickerLabel = periodLabelForKeyframeDate(first[0], dv, periodsOrdered)
  const t = d3.select(svgEl).transition().duration(0)
  renderExplainedFrame(ctx, first, t, tickerLabel)
}

const runBarChartRace = async (rawData: RawDataItem[], settings: ChartRenderSettings) => {
  const svgEl = resolveChartSvgEl()
  if (!svgEl) return
  const myGen = ++raceGeneration

  const raw = rawData as RawRaceRow[]
  const periodsOrdered = sortedPeriodsFromRaw(raw)
  if (periodsOrdered.length === 0) return

  const dv = datevalues(raw, periodsOrdered)
  const namesSet = allNames(raw)
  const topN = Math.min(12, Math.max(1, namesSet.size))
  const rank = rankFactory(namesSet, topN)
  const keyframes = buildKeyframes(dv, keyframeSteps, rank)
  if (keyframes.length === 0) return

  const { width } = getChartDimensions()
  const options: ExplainedChartOptions = {
    width,
    topN,
    barSize: BAR_HEIGHT_PX,
    durationMs: explainedDurationMs,
    keyframeSteps,
    margin: explainedMargin,
    color: getBarColor,
    labelFill: settings.labelColor,
    labelLayoutMode: settings.labelLayoutMode,
    valueFontSizePx: VALUE_FONT_SIZE_PX,
  }
  const labelFont = `bold ${NAME_FONT_SIZE_PX}px var(--sans-serif, ui-sans-serif, system-ui, sans-serif)`

  const ctx = createExplainedContext(svgEl, keyframes, periodsOrdered, options, labelFont)
  if (!ctx) return

  for (let i = 0; i < keyframes.length; i++) {
    if (myGen !== raceGeneration) return
    const kf = keyframes[i]!
    const tickerLabel = periodLabelForKeyframeDate(kf[0], dv, periodsOrdered)
    const t = d3
      .select(svgEl)
      .transition()
      .duration(explainedDurationMs)
      .ease(d3.easeLinear)
    renderExplainedFrame(ctx, kf, t, tickerLabel)
    await t.end()
    if (myGen !== raceGeneration) return
  }
}

const startPlayWithData = (data: RawDataItem[]) => {
  clearTimers()
  mobileFloatActionsReady.value = false
  isAnimating.value = false
  countdown.value = 5

  countdownInterval = window.setInterval(() => {
    if (countdown.value === null) return
    countdown.value -= 1
    if (countdown.value <= 0) {
      if (countdownInterval !== null) {
        window.clearInterval(countdownInterval)
        countdownInterval = null
      }
      countdown.value = null
    }
  }, 1000)

  startTimeout = window.setTimeout(async () => {
    if (isMobileLayout.value) {
      chartPanelOpen.value = true
      await nextTick()
      scheduleSyncTelegramBackButton()
    }
    isAnimating.value = true
    const settings = getCurrentSettings()
    try {
      await runBarChartRace(data, settings)
    } finally {
      isAnimating.value = false
      if (postRaceFloatTimer !== null) {
        window.clearTimeout(postRaceFloatTimer)
      }
      postRaceFloatTimer = window.setTimeout(() => {
        mobileFloatActionsReady.value = true
        postRaceFloatTimer = null
      }, 1000)
    }
    startTimeout = null
  }, 5000)
}

const closePlayReminder = () => {
  playReminderOpen.value = false
  pendingPlayData.value = null
}

const confirmPlayReminder = () => {
  if (!pendingPlayData.value) {
    closePlayReminder()
    return
  }
  const data = pendingPlayData.value
  closePlayReminder()
  startPlayWithData(data)
}

const onPlay = () => {
  if (!canStartPlay.value) {
    errorMessage.value = playDisabledReason.value
    return
  }
  const data = collectDataFromForm()
  if (!data) return
  pendingPlayData.value = data
  playReminderOpen.value = true
}

const openGenerationsDrawer = () => {
  generationsDrawerOpen.value = true
  if (!topupPackages.value.length) {
    void loadTopupPackages()
  }
  void loadTopupPayments(20)
}

const closeGenerationsDrawer = () => {
  generationsDrawerOpen.value = false
}

onBeforeUnmount(() => {
  raceGeneration += 1
  clearTimers()
  document.body.style.overflow = ''
  window.removeEventListener('resize', handleWindowResize)
  document.removeEventListener('keydown', onChartPanelKeydown)
  try {
    WebApp.offEvent?.('viewportChanged', syncTelegramViewportInsets)
    WebApp.BackButton.offClick(onTelegramBackClosePanel)
    WebApp.BackButton.hide()
  } catch {
    /* no-op */
  }
})

const handleWindowResize = () => {
  syncMobileLayout()
  if (isAnimating.value || countdown.value !== null) return
  void nextTick(() => renderPreviewChart(collectDataForPreview()))
}

watch(
  [periods, names, labelLayoutMode],
  () => {
    if (isAnimating.value || countdown.value !== null) return
    renderPreviewChart(collectDataForPreview())
  },
  { deep: true },
)

watch(chartPanelOpen, (open) => {
  if (typeof document === 'undefined') return
  if (isMobileLayout.value && open) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

watch([chartPanelOpen, isMobileLayout], () => {
  if (!isMobileLayout.value) return
  if (isAnimating.value || countdown.value !== null) return
  void nextTick(() => renderPreviewChart(collectDataForPreview()))
})

watch([chartPanelOpen, isMobileLayout], () => {
  scheduleSyncTelegramBackButton()
})

onMounted(() => {
  try {
    getApiBaseUrlOrThrow()
  } catch (error) {
    endpointMissing.value = true
    const normalized = mapApiError(error)
    bootstrapError.value = normalized.message
    console.error('[env] VITE_APP_REST_ENDPOINT is required')
  }
  syncMobileLayout()
  syncTelegramViewportInsets()
  renderPreviewChart(collectDataForPreview())
  window.addEventListener('resize', handleWindowResize)
  document.addEventListener('keydown', onChartPanelKeydown)
  try {
    WebApp.onEvent?.('viewportChanged', syncTelegramViewportInsets)
  } catch {
    /* no-op */
  }
  scheduleSyncTelegramBackButton()
  if (!endpointMissing.value) {
    void loadSession()
    void loadTopupPackages()
  }
})
</script>

<template>
  <main
    :style="mainContainerStyle"
    class="box-border min-w-0 max-w-[100vw] overflow-x-hidden bg-slate-100 text-slate-900 sm:pb-6 sm:pl-4 sm:pr-4 sm:pt-4 lg:px-6 lg:pt-6"
  >
    <div class="mx-auto grid w-full min-w-0 max-w-7xl gap-3 sm:gap-4 lg:grid-cols-2 lg:gap-6">
      <section
        class="min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm sm:p-4 lg:rounded-2xl lg:p-6"
      >
        <h1 class="mb-3 break-words text-xl font-bold tracking-tight sm:mb-4 sm:text-2xl">
          {{ t('chart.settingsTitle') }}
        </h1>
        <div class="mb-3 flex items-center justify-between gap-2 sm:mb-4">
          <div class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 text-xs">
            <span class="px-2 text-slate-600">{{ t('language') }}</span>
            <button
              type="button"
              class="rounded px-2.5 py-1 transition"
              :class="locale === 'ru' ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-100'"
              @click="setLocale('ru')"
            >
              RU
            </button>
            <button
              type="button"
              class="rounded px-2.5 py-1 transition"
              :class="locale === 'en' ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-100'"
              @click="setLocale('en')"
            >
              EN
            </button>
          </div>

          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            @click="openGenerationsDrawer"
            :aria-label="t('chart.generationsAriaLabel')"
          >
            <span class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300" aria-hidden="true">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke-linejoin="round" />
              </svg>
            </span>
            <span>{{ availableGenerations }}</span>
            <span class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-sm leading-none">+</span>
          </button>
        </div>

        <div class="mb-3 sm:mb-4">
          <label class="mb-1 block text-xs font-medium text-slate-700 sm:text-sm">{{ t('chart.title') }}</label>
          <input
            v-model="chartTitle"
            type="text"
            class="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[15px] outline-none focus:border-blue-500 sm:px-3 sm:py-2"
            :placeholder="t('chart.titlePlaceholder')"
          />
        </div>

        <div class="mb-3 sm:mb-4">
          <label class="mb-1 block text-xs font-medium text-slate-700 sm:text-sm"
            >{{ t('chart.description') }}</label
          >
          <textarea
            v-model="chartDescription"
            rows="2"
            class="min-h-[4.5rem] w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[15px] outline-none focus:border-blue-500 sm:min-h-[5.5rem] sm:px-3 sm:py-2"
            :placeholder="t('chart.descriptionPlaceholder')"
          />
        </div>

        <div
          class="mb-3 min-w-0 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-3 sm:mb-4 sm:p-4"
        >
          <p class="mb-1 text-xs font-medium sm:text-sm">{{ t('chart.csvTitle') }}</p>
          <p
            class="mb-2 break-words text-[11px] leading-snug text-slate-600 sm:mb-3 sm:text-xs sm:leading-relaxed"
          >
            {{ t('chart.csvDescription') }}
          </p>
          <input
            ref="csvFileInput"
            type="file"
            accept=".csv,.txt,text/csv,text/plain,text/comma-separated-values,application/vnd.ms-excel,application/octet-stream"
            class="sr-only"
            @change="onCsvFile"
          />
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 sm:px-4 sm:py-2 sm:text-sm"
            @click="triggerCsvPick"
          >
            {{ t('chart.chooseCsv') }}
          </button>
        </div>

        <div class="mb-3 sm:mb-4">
          <label class="mb-1.5 block text-xs font-medium text-slate-700 sm:mb-2 sm:text-sm"
            >{{ t('chart.labelLayoutTitle') }}</label
          >
          <p class="mb-2 text-[11px] text-slate-500 sm:mb-3 sm:text-xs">
            {{ t('chart.labelLayoutHelp') }}
          </p>
          <div class="grid min-w-0 gap-2 sm:grid-cols-2 sm:gap-3">
            <label
              class="flex min-w-0 cursor-pointer items-start gap-2 rounded-xl border p-3 transition sm:gap-3 sm:p-3.5"
              :class="
                labelLayoutMode === 'mode3'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              "
            >
              <input v-model="labelLayoutMode" type="radio" value="mode3" class="mt-0.5 h-3.5 w-3.5 sm:mt-1 sm:h-4 sm:w-4" />
              <span class="min-w-0 flex-1 text-xs leading-snug text-slate-700 sm:text-sm">
                <span class="block font-semibold text-slate-900">{{ t('chart.right') }}</span>
                <span class="mt-0.5 block text-[11px] text-slate-500 sm:text-xs">
                  {{ t('chart.rightDesc') }}
                </span>
              </span>
            </label>

            <label
              class="flex min-w-0 cursor-pointer items-start gap-2 rounded-xl border p-3 transition sm:gap-3 sm:p-3.5"
              :class="
                labelLayoutMode === 'mode4'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              "
            >
              <input v-model="labelLayoutMode" type="radio" value="mode4" class="mt-0.5 h-3.5 w-3.5 sm:mt-1 sm:h-4 sm:w-4" />
              <span class="min-w-0 flex-1 text-xs leading-snug text-slate-700 sm:text-sm">
                <span class="block font-semibold text-slate-900">{{ t('chart.left') }}</span>
                <span class="mt-0.5 block text-[11px] text-slate-500 sm:text-xs">
                  {{ t('chart.leftDesc') }}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div
          class="mb-3 flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 sm:mb-4 sm:px-3.5 sm:py-2.5"
        >
          <p class="min-w-0 leading-snug">
            {{ t('chart.demoDataBadge') }}
          </p>
          <button
            type="button"
            class="shrink-0 rounded-md border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 sm:text-xs"
            @click="clearAllSampleData"
          >
            {{ t('chart.clear') }}
          </button>
        </div>

        <div class="mb-3 rounded-lg border border-slate-200 p-3 sm:mb-4 sm:p-4">
          <p class="mb-2 text-xs font-semibold text-slate-800 sm:text-sm">{{ t('chart.itemsSection') }}</p>
          <div class="mb-2 flex min-w-0 gap-1.5 sm:mb-3 sm:gap-2">
            <input
              v-model="newNameText"
              type="text"
              class="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[15px] outline-none focus:border-blue-500 sm:px-3 sm:py-2"
              :placeholder="t('chart.itemPlaceholder')"
            />
            <button
              type="button"
              class="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 sm:px-4 sm:py-2 sm:text-sm"
              @click="addName"
            >
              {{ t('chart.add') }}
            </button>
          </div>

          <div class="flex flex-wrap gap-1.5 sm:gap-2">
            <span
              v-for="nameItem in names"
              :key="nameItem.id"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm"
            >
              {{ nameItem.name }}
              <button
                type="button"
                class="text-red-500"
                @click="removeName(nameItem.id)"
              >
                ×
              </button>
            </span>
          </div>
        </div>

        <div class="mb-3 rounded-lg border border-slate-200 p-3 sm:mb-4 sm:p-4">
          <p class="mb-2 text-xs font-semibold text-slate-800 sm:text-sm">{{ t('chart.periodsSection') }}</p>
          <div class="mb-2 flex min-w-0 gap-1.5 sm:mb-3 sm:gap-2">
            <input
              v-model="newPeriodText"
              type="text"
              inputmode="numeric"
              enterkeyhint="done"
              autocomplete="off"
              class="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[15px] text-slate-900 outline-none focus:border-blue-500 sm:px-3 sm:py-2"
              :placeholder="t('chart.periodPlaceholder')"
            />
            <button
              type="button"
              class="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 sm:px-4 sm:py-2 sm:text-sm"
              @click="addPeriod"
            >
              {{ t('chart.add') }}
            </button>
          </div>

          <div class="flex flex-wrap gap-1.5 sm:gap-2">
            <button
              v-for="periodItem in periods"
              :key="periodItem.id"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm"
              :class="
                selectedPeriodId === periodItem.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-700'
              "
              @click="selectPeriod(periodItem.id)"
            >
              {{ periodItem.period || t('chart.untitled') }}
              <span
                class="cursor-pointer text-red-500"
                @click.stop="removePeriod(periodItem.id)"
              >
                ×
              </span>
            </button>
          </div>
        </div>

        <div class="mb-3 rounded-lg border border-slate-200 p-3 sm:mb-4 sm:p-4">
          <div
            class="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
          >
            <p class="min-w-0 break-words text-xs font-semibold leading-snug text-slate-800 sm:text-sm">
              {{ t('chart.valuesSection') }}
              <span class="text-blue-700">{{ selectedPeriod?.period || '—' }}</span>
            </p>
          </div>

          <div v-if="!selectedPeriod" class="text-xs text-slate-500 sm:text-sm">
            {{ t('chart.noPeriod') }}
          </div>

          <div v-else class="space-y-1.5 sm:space-y-2">
            <div
              v-for="valueItem in selectedPeriod.values"
              :key="valueItem.name"
              class="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:gap-3 sm:p-2.5"
            >
              <input
                :value="valueItem.name"
                type="text"
                class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 sm:px-3 sm:py-2 sm:text-sm"
                disabled
              />
              <input
                v-model.number="valueItem.value"
                type="number"
                inputmode="decimal"
                enterkeyhint="done"
                min="0"
                step="any"
                class="w-28 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs tabular-nums text-slate-900 outline-none focus:border-blue-500 sm:w-36 sm:px-3 sm:py-2 sm:text-sm"
                :placeholder="t('chart.valuePlaceholder')"
              />
            </div>
          </div>
        </div>

        <p v-if="errorMessage" class="mb-3 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 sm:mb-4 sm:px-3 sm:py-2 sm:text-sm">
          {{ errorMessage }}
        </p>
        <p
          v-else-if="!canStartPlay"
          class="mb-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 sm:mb-4 sm:px-3 sm:py-2 sm:text-sm"
        >
          {{ playDisabledReason }}
        </p>

        <div
          v-if="countdown !== null"
          class="mb-3 flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 px-3 py-3 text-slate-700 shadow-inner sm:mb-4 sm:px-4 sm:py-3.5"
        >
          <span class="text-xs font-medium sm:text-sm">{{ t('chart.startIn') }}</span>
          <span class="min-w-[2.5ch] text-center text-2xl font-bold tabular-nums text-blue-600 sm:text-3xl">{{ countdown }}</span>
          <span class="text-xs sm:text-sm">{{ t('chart.secShort') }}</span>
        </div>
        <button
          v-else-if="isAnimating"
          type="button"
          disabled
          class="mb-3 cursor-not-allowed rounded-lg bg-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 sm:mb-4 sm:px-5 sm:py-2"
        >
          {{ t('chart.animating') }}
        </button>
      </section>

      <section
        class="hidden min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm lg:flex lg:rounded-2xl lg:p-5"
      >
        <div class="flex min-w-0 flex-wrap items-start justify-between gap-2 sm:gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-bold tracking-tight sm:text-xl">{{ chartTitle || t('chart.untitled') }}</h2>
            <p v-if="chartDescription" class="mt-0.5 text-xs text-slate-600 sm:text-sm">{{ chartDescription }}</p>
          </div>
          <button
            v-if="showChartPlay"
            type="button"
            :disabled="!canStartPlay"
            :title="!canStartPlay ? playDisabledReason : undefined"
            class="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none disabled:hover:bg-slate-300 sm:px-5 sm:py-2.5 sm:text-sm"
            @click="onPlay"
          >
            {{ t('chart.play') }}
          </button>
        </div>
        <div class="relative mt-3 min-h-[480px] min-w-0 lg:min-h-[520px]">
          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <div
              v-if="countdown !== null"
              class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border border-blue-100 bg-gradient-to-b from-white/95 to-blue-50/95 px-4 shadow-inner backdrop-blur-[2px]"
              aria-live="polite"
            >
              <span class="text-sm font-medium tracking-wide text-slate-500">{{ t('chart.startIn') }}</span>
              <span
                class="mt-1 animate-pulse text-7xl font-bold tabular-nums leading-none text-blue-600 drop-shadow-sm"
                >{{ countdown }}</span
              >
              <span class="mt-2 text-xs font-medium uppercase tracking-widest text-slate-400">{{ t('chart.seconds') }}</span>
            </div>
          </Transition>
          <svg
            ref="svgRef"
            class="h-[480px] w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-white lg:h-[520px]"
          ></svg>
        </div>
      </section>
    </div>

    <button
      v-show="isMobileLayout && !chartPanelOpen && showMobileChartFloats"
      type="button"
      :style="mobileFabStyle"
      class="fixed z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg ring-2 ring-white/20 transition hover:bg-blue-700 active:scale-95 sm:h-16 sm:w-16 lg:hidden"
      :aria-label="t('chart.openChart')"
      @click="openChartPanel"
    >
      <svg class="h-7 w-7 sm:h-8 sm:w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M4 19h16M4 15l4-4 4 4 4-8 4 4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition duration-250 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <div
        v-if="isMobileLayout && chartPanelOpen"
        class="fixed inset-0 z-[60] flex max-h-[100dvh] max-w-[100vw] flex-col overflow-x-hidden bg-white lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-panel-title"
      >
        <div
          :style="mobilePanelHeaderStyle"
          class="min-w-0 shrink-0 border-b border-slate-200 px-3 py-2.5 sm:px-4 sm:py-3"
        >
          <h2 id="chart-panel-title" class="break-words text-base font-bold leading-snug sm:text-lg">
            {{ chartTitle || t('chart.untitled') }}
          </h2>
          <p v-if="chartDescription" class="mt-0.5 break-words text-xs text-slate-600 sm:text-sm">
            {{ chartDescription }}
          </p>
        </div>
        <div
          :style="mobilePanelBodyStyle"
          class="relative min-h-0 min-w-0 flex-1 overflow-x-hidden px-3 pt-2 sm:px-4 sm:pb-[max(5.5rem,env(safe-area-inset-bottom))] sm:pt-3"
        >
          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <div
              v-if="countdown !== null"
              class="pointer-events-none absolute inset-x-3 inset-y-2 z-10 flex flex-col items-center justify-center rounded-lg border border-blue-100 bg-gradient-to-b from-white/95 to-blue-50/95 px-3 shadow-inner backdrop-blur-[2px] sm:inset-x-4 sm:inset-y-3 sm:px-4"
              aria-live="polite"
            >
              <span class="text-sm font-medium tracking-wide text-slate-500">{{ t('chart.startIn') }}</span>
              <span
                class="mt-1 animate-pulse text-6xl font-bold tabular-nums leading-none text-blue-600 drop-shadow-sm sm:text-7xl"
                >{{ countdown }}</span
              >
              <span class="mt-2 text-xs font-medium uppercase tracking-widest text-slate-400">{{ t('chart.seconds') }}</span>
            </div>
          </Transition>
          <svg
            ref="svgRefMobile"
            class="h-full min-h-[240px] w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-white"
          ></svg>

          <div
            v-if="showMobileChartFloats"
            class="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-[70]"
            aria-hidden="true"
          >
            <div
              :style="mobilePanelFloatsStyle"
              class="pointer-events-auto absolute flex flex-col gap-2 sm:gap-3"
            >
              <button
                v-if="showCustomPanelCloseButton"
                type="button"
                class="flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg ring-1 ring-black/5 transition hover:bg-slate-50 active:scale-95 sm:h-16 sm:w-16"
                :aria-label="t('chart.close')"
                @click="closeChartPanel"
              >
                <svg class="h-6 w-6 sm:h-7 sm:w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <button
                type="button"
                :disabled="!canStartPlay"
                :title="!canStartPlay ? playDisabledReason : undefined"
                class="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg ring-2 ring-blue-500/30 transition hover:bg-blue-700 active:scale-95 sm:h-16 sm:w-16"
                :class="!canStartPlay ? 'cursor-not-allowed bg-slate-300 text-slate-600 ring-slate-300/40 hover:bg-slate-300' : ''"
                :aria-label="t('chart.startAnimation')"
                @click="onPlay"
              >
                <svg class="ml-0.5 h-7 w-7 sm:h-8 sm:w-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.14v14l11-7-11-6.86z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition
      enter-active-class="transition duration-250 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="generationsDrawerOpen"
        class="fixed inset-0 z-[85] bg-slate-950/35 backdrop-blur-[1px]"
        @click="closeGenerationsDrawer"
      ></div>
    </Transition>

    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-220 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="generationsDrawerOpen"
        class="fixed bottom-0 left-0 right-0 z-[86] mx-auto w-full max-w-xl rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
        @click.stop
      >
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-slate-900 sm:text-base">{{ t('chart.generationsPurchaseTitle') }}</h3>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
            @click="closeGenerationsDrawer"
          >
            {{ t('chart.close') }}
          </button>
        </div>

        <div class="mb-3 grid grid-cols-2 gap-2">
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p class="text-[11px] text-slate-500">{{ t('chart.balancePaid') }}</p>
            <p class="text-sm font-semibold text-slate-900">{{ paidBalance }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p class="text-[11px] text-slate-500">{{ t('chart.balanceFree') }}</p>
            <p class="text-sm font-semibold text-slate-900">{{ freeBalance }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <p v-if="topupPackagesLoading" class="text-xs text-slate-500">{{ t('chart.topupLoadingPackages') }}</p>
          <p v-else-if="!visibleTopupPackages.length" class="text-xs text-slate-500">{{ t('chart.topupNoPackages') }}</p>
          <div
            v-for="pack in visibleTopupPackages"
            :key="`${pack.units}-${pack.stars}`"
            class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <span class="text-sm text-slate-700">{{ generationAmountLabel(pack.units) }}</span>
            <span class="text-sm font-semibold text-slate-900">{{ pack.stars }} ⭐</span>
            <button
              type="button"
              class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="topupActionLoading"
              @click="buyTopup(pack)"
            >
              {{ t('chart.buy') }}
            </button>
          </div>
        </div>

        <p v-if="topupStatus !== 'idle'" class="mt-3 text-xs text-slate-600">
          {{ t('chart.topupStatus') }}: {{ topupStatus }}
        </p>
        <p v-if="topupError" class="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {{ topupError }}
        </p>

        <div class="mt-3">
          <p class="mb-1 text-xs font-medium text-slate-700">{{ t('chart.topupHistory') }}</p>
          <p v-if="topupPaymentsLoading" class="text-xs text-slate-500">{{ t('chart.topupLoadingHistory') }}</p>
          <div v-else class="max-h-24 space-y-1 overflow-y-auto pr-1">
            <div
              v-for="(payment, paymentIndex) in topupPayments"
              :key="String(payment.id ?? paymentIndex)"
              class="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
            >
              {{ payment.units ?? 0 }}/{{ payment.stars ?? 0 }} ⭐ - {{ payment.status ?? 'pending' }}
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition
      enter-active-class="transition duration-250 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="playReminderOpen"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-reminder-title"
      >
        <div
          class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
        >
          <h3 id="play-reminder-title" class="text-base font-semibold text-slate-900 sm:text-lg">
            {{ t('chart.playReminderTitle') }}
          </h3>
          <p class="mt-2 text-sm leading-relaxed text-slate-600">
            {{ t('chart.playReminderText') }}
          </p>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 sm:text-sm"
              @click="closePlayReminder"
            >
              {{ t('chart.playReminderCancel') }}
            </button>
            <button
              type="button"
              class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 sm:text-sm"
              @click="confirmPlayReminder"
            >
              {{ t('chart.playReminderDone') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </main>
</template>
