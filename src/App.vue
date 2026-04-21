<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as d3 from 'd3'
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
  barHeightPx: number
  labelLayoutMode: LabelLayoutMode
  nameFontSizePx: number
  valueFontSizePx: number
  labelColor: string
}

const chartTitle = ref('Top Sales by Year')
const chartDescription = ref('Bar Chart Race на основе периодов')
const labelLayoutMode = ref<LabelLayoutMode>('mode1')
const barHeightPx = ref(50)
const nameFontSizePx = ref(13)
const valueFontSizePx = ref(13)
const labelColor = ref('#334155')
const names = ref<NameItem[]>([
  { id: crypto.randomUUID(), name: 'Product A', color: '#1d4ed8' },
  { id: crypto.randomUUID(), name: 'Product B', color: '#dc2626' },
  { id: crypto.randomUUID(), name: 'Product C', color: '#059669' },
])
const newNameText = ref('')
const periods = ref<PeriodForm[]>([
  {
    id: crypto.randomUUID(),
    period: '2021',
    values: [
      { name: 'Product A', value: 10, period: '2021' },
      { name: 'Product B', value: 15, period: '2021' },
      { name: 'Product C', value: 7, period: '2021' },
    ],
  },
  {
    id: crypto.randomUUID(),
    period: '2022',
    values: [
      { name: 'Product A', value: 18, period: '2022' },
      { name: 'Product B', value: 12, period: '2022' },
      { name: 'Product C', value: 14, period: '2022' },
    ],
  },
  {
    id: crypto.randomUUID(),
    period: '2023',
    values: [
      { name: 'Product A', value: 22, period: '2023' },
      { name: 'Product B', value: 16, period: '2023' },
      { name: 'Product C', value: 20, period: '2023' },
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
const countdown = ref<number | null>(null)
const isAnimating = ref(false)

let startTimeout: number | null = null
let countdownInterval: number | null = null

const canPlay = computed(() => !isAnimating.value && countdown.value === null)
const selectedPeriod = computed(() =>
  periods.value.find((period) => period.id === selectedPeriodId.value),
)

const getNameByName = (name: string) => names.value.find((item) => item.name === name)
const getBarColor = (name: string) => getNameByName(name)?.color ?? '#64748b'
const updateBarColor = (name: string, color: string) => {
  const item = getNameByName(name)
  if (!item) return
  item.color = color
}

const randomColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`

const randomizeAllBarColors = () => {
  names.value = names.value.map((item) => ({ ...item, color: randomColor() }))
}

const getCurrentSettings = (): ChartRenderSettings => ({
  barHeightPx: barHeightPx.value,
  labelLayoutMode: labelLayoutMode.value,
  nameFontSizePx: nameFontSizePx.value,
  valueFontSizePx: valueFontSizePx.value,
  labelColor: labelColor.value,
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
    errorMessage.value = 'Введите название элемента.'
    return
  }

  const exists = names.value.some((item) => item.name === name)
  if (exists) {
    errorMessage.value = 'Такое название уже существует.'
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
    errorMessage.value = 'Введите название периода.'
    return
  }

  const exists = periods.value.some((item) => item.period === period)
  if (exists) {
    errorMessage.value = 'Такой период уже существует.'
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
    const res = importBarChartRaceCsv(text)
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
    errorMessage.value = 'Не удалось прочитать файл.'
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
  countdown.value = null
}

const collectDataFromForm = (): RawDataItem[] | null => {
  if (periods.value.length === 0) {
    errorMessage.value = 'Добавьте хотя бы один период.'
    return null
  }
  if (names.value.length === 0) {
    errorMessage.value = 'Добавьте хотя бы одно название элемента.'
    return null
  }

  const normalized: RawDataItem[] = []
  for (const periodItem of periods.value) {
    const period = periodItem.period.trim()
    if (!period) {
      errorMessage.value = 'У каждого периода должно быть название.'
      return null
    }

    if (periodItem.values.length !== names.value.length) {
      errorMessage.value = `В периоде "${period}" должен быть полный список названий.`
      return null
    }

    for (const valueItem of periodItem.values) {
      const name = valueItem.name.trim()
      const value = Number(valueItem.value)
      const isInvalid = !name || Number.isNaN(value) || !Number.isFinite(value) || value < 0
      if (isInvalid) {
        errorMessage.value = `Проверьте значения в периоде "${period}" (value >= 0).`
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
    barSize: barHeightPx.value,
    durationMs: explainedDurationMs,
    keyframeSteps,
    margin: explainedMargin,
    color: getBarColor,
    labelFill: labelColor.value,
  }
  const labelFont = `bold ${nameFontSizePx.value}px var(--sans-serif, ui-sans-serif, system-ui, sans-serif)`

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
    barSize: settings.barHeightPx,
    durationMs: explainedDurationMs,
    keyframeSteps,
    margin: explainedMargin,
    color: getBarColor,
    labelFill: settings.labelColor,
  }
  const labelFont = `bold ${settings.nameFontSizePx}px var(--sans-serif, ui-sans-serif, system-ui, sans-serif)`

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

const onPlay = () => {
  const data = collectDataFromForm()
  if (!data) return

  clearTimers()
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
    }
    isAnimating.value = true
    const settings = getCurrentSettings()
    await runBarChartRace(data, settings)
    isAnimating.value = false
    startTimeout = null
  }, 5000)
}

onBeforeUnmount(() => {
  raceGeneration += 1
  clearTimers()
  document.body.style.overflow = ''
  window.removeEventListener('resize', handleWindowResize)
  document.removeEventListener('keydown', onChartPanelKeydown)
})

const handleWindowResize = () => {
  syncMobileLayout()
  if (isAnimating.value || countdown.value !== null) return
  void nextTick(() => renderPreviewChart(collectDataForPreview()))
}

watch(
  [periods, names, labelLayoutMode, barHeightPx, nameFontSizePx, valueFontSizePx, labelColor],
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

onMounted(() => {
  syncMobileLayout()
  renderPreviewChart(collectDataForPreview())
  window.addEventListener('resize', handleWindowResize)
  document.addEventListener('keydown', onChartPanelKeydown)
})
</script>

<template>
  <main class="min-h-screen bg-slate-100 p-6 text-slate-900">
    <div class="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-2">
      <section class="rounded-2xl bg-white p-6 shadow-sm">
        <h1 class="mb-4 text-2xl font-bold">Настройки Bar Chart Race</h1>

        <div class="mb-4">
          <label class="mb-1 block text-sm font-medium">Название</label>
          <input
            v-model="chartTitle"
            type="text"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            placeholder="Введите заголовок графика"
          />
        </div>

        <div class="mb-4">
          <label class="mb-1 block text-sm font-medium">Описание (необязательно)</label>
          <textarea
            v-model="chartDescription"
            rows="3"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            placeholder="Введите описание"
          />
        </div>

        <div class="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-4">
          <p class="mb-1 text-sm font-medium">Импорт CSV (по желанию)</p>
          <p class="mb-3 text-xs leading-relaxed text-slate-600">
            Формат как в D3 Bar Chart Race:
            <code class="rounded bg-white px-1 py-0.5 text-[11px] text-slate-800">date, name, value</code>
            и при необходимости
            <code class="rounded bg-white px-1 py-0.5 text-[11px] text-slate-800">category</code>
            (год берётся из даты). Альтернатива без даты:
            <code class="rounded bg-white px-1 py-0.5 text-[11px] text-slate-800">name, value, period</code>
            . Импорт заменяет названия, периоды и значения в форме.
          </p>
          <input
            ref="csvFileInput"
            type="file"
            accept=".csv,text/csv"
            class="sr-only"
            @change="onCsvFile"
          />
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            @click="triggerCsvPick"
          >
            Выбрать CSV…
          </button>
        </div>

        <div class="mb-4">
          <label class="mb-2 block text-sm font-medium">Отображение текста на барах</label>
          <p class="mb-2 text-xs text-slate-500">
            График в стиле D3 «Bar Chart Race, Explained»: подписи у правого края бара; пункты ниже зарезервированы.
          </p>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
              :class="
                labelLayoutMode === 'mode1'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              "
            >
              <input v-model="labelLayoutMode" type="radio" value="mode1" class="mt-1 h-4 w-4" />
              <span class="text-sm text-slate-700">1. Как сейчас</span>
            </label>

            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
              :class="
                labelLayoutMode === 'mode2'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              "
            >
              <input v-model="labelLayoutMode" type="radio" value="mode2" class="mt-1 h-4 w-4" />
              <span class="text-sm text-slate-700">2. Название и значение внутри бара</span>
            </label>

            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
              :class="
                labelLayoutMode === 'mode3'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              "
            >
              <input v-model="labelLayoutMode" type="radio" value="mode3" class="mt-1 h-4 w-4" />
              <span class="text-sm text-slate-700">
                3. Название и значение друг под другом в правом конце бара
              </span>
            </label>

            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
              :class="
                labelLayoutMode === 'mode4'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              "
            >
              <input v-model="labelLayoutMode" type="radio" value="mode4" class="mt-1 h-4 w-4" />
              <span class="text-sm text-slate-700">
                4. Как 3, только в левом конце бара
              </span>
            </label>
          </div>
        </div>

        <div class="mb-4">
          <label class="mb-1 block text-sm font-medium">Высота бара: {{ barHeightPx }} px</label>
          <input
            v-model.number="barHeightPx"
            type="range"
            min="50"
            max="100"
            step="1"
            class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200"
          />
        </div>

        <div class="mb-4 grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium">Размер шрифта названия: {{ nameFontSizePx }} px</label>
            <input
              v-model.number="nameFontSizePx"
              type="range"
              min="10"
              max="28"
              step="1"
              class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Размер шрифта значения: {{ valueFontSizePx }} px</label>
            <input
              v-model.number="valueFontSizePx"
              type="range"
              min="10"
              max="28"
              step="1"
              class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="mb-1 block text-sm font-medium">Цвет текста на барах</label>
            <input
              v-model="labelColor"
              type="color"
              class="h-10 w-20 cursor-pointer rounded border border-slate-300 bg-white p-1"
            />
          </div>
        </div>

        <div class="mb-4 rounded-lg border border-slate-200 p-4">
          <p class="mb-2 text-sm font-semibold">1) Названия элементов</p>
          <div class="mb-3 flex gap-2">
            <input
              v-model="newNameText"
              type="text"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              placeholder="Например: Product A"
            />
            <button
              type="button"
              class="rounded-lg bg-slate-800 px-4 py-2 text-white hover:bg-slate-900"
              @click="addName"
            >
              Добавить
            </button>
          </div>

          <div class="flex flex-wrap gap-2">
            <span
              v-for="nameItem in names"
              :key="nameItem.id"
              class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
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

        <div class="mb-4 rounded-lg border border-slate-200 p-4">
          <p class="mb-2 text-sm font-semibold">2) Даты / периоды</p>
          <div class="mb-3 flex gap-2">
            <input
              v-model="newPeriodText"
              type="text"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              placeholder="Например: 2024"
            />
            <button
              type="button"
              class="rounded-lg bg-slate-800 px-4 py-2 text-white hover:bg-slate-900"
              @click="addPeriod"
            >
              Добавить
            </button>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              v-for="periodItem in periods"
              :key="periodItem.id"
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              :class="
                selectedPeriodId === periodItem.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-700'
              "
              @click="selectPeriod(periodItem.id)"
            >
              {{ periodItem.period || 'Без названия' }}
              <span
                class="cursor-pointer text-red-500"
                @click.stop="removePeriod(periodItem.id)"
              >
                ×
              </span>
            </button>
          </div>
        </div>

        <div class="mb-4 rounded-lg border border-slate-200 p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-sm font-semibold">
              3) Значения для периода:
              <span class="text-blue-700">{{ selectedPeriod?.period || '—' }}</span>
            </p>
            <button
              type="button"
              class="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
              @click="randomizeAllBarColors"
            >
              Случайные цвета для всех баров
            </button>
          </div>

          <div v-if="!selectedPeriod" class="text-sm text-slate-500">
            Сначала добавьте и выберите период.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="valueItem in selectedPeriod.values"
              :key="valueItem.name"
              class="grid grid-cols-12 gap-2"
            >
              <input
                :value="valueItem.name"
                type="text"
                class="col-span-7 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                disabled
              />
              <input
                v-model.number="valueItem.value"
                type="number"
                min="0"
                class="col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="Значение"
              />
              <input
                :value="getBarColor(valueItem.name)"
                type="color"
                class="col-span-2 h-10 w-full cursor-pointer rounded border border-slate-300 bg-white p-1"
                @input="updateBarColor(valueItem.name, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </div>

        <p v-if="errorMessage" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ errorMessage }}
        </p>

        <button
          type="button"
          :disabled="!canPlay"
          class="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white transition enabled:hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          @click="onPlay"
        >
          {{ countdown !== null ? `Старт через ${countdown} сек` : isAnimating ? 'Анимация...' : 'Play' }}
        </button>
      </section>

      <section class="hidden flex-col rounded-2xl bg-white p-6 shadow-sm lg:flex">
        <h2 class="text-xl font-bold">{{ chartTitle || 'Без названия' }}</h2>
        <p v-if="chartDescription" class="mt-1 text-sm text-slate-600">{{ chartDescription }}</p>
        <svg ref="svgRef" class="mt-4 h-[520px] w-full rounded-lg border border-slate-200 bg-white"></svg>
      </section>
    </div>

    <button
      v-show="isMobileLayout && !chartPanelOpen"
      type="button"
      class="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg ring-2 ring-white/20 transition hover:bg-blue-700 active:scale-95 lg:hidden"
      aria-label="Открыть график"
      @click="openChartPanel"
    >
      <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
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
        class="fixed inset-0 z-[60] flex max-h-[100dvh] flex-col bg-white lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-panel-title"
      >
        <div class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div class="min-w-0 flex-1">
            <h2 id="chart-panel-title" class="text-lg font-bold leading-tight">
              {{ chartTitle || 'Без названия' }}
            </h2>
            <p v-if="chartDescription" class="mt-1 text-sm text-slate-600">{{ chartDescription }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            @click="closeChartPanel"
          >
            Закрыть
          </button>
        </div>
        <div class="min-h-0 flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <svg
            ref="svgRefMobile"
            class="h-full min-h-[240px] w-full rounded-lg border border-slate-200 bg-white"
          ></svg>
        </div>
      </div>
    </Transition>
  </main>
</template>
