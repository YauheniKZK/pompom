<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as d3 from 'd3'

type RawDataItem = {
  name: string
  value: number
  period: string
}

type RankedItem = {
  name: string
  value: number
  rank: number
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
const lineHeightFactor = 1.2
const stackedTextGapPx = 2

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

const getStackedLabelY = (centerY: number, nameFontSize: number, valueFontSize: number) => {
  const nameLineHeight = nameFontSize * lineHeightFactor
  const valueLineHeight = valueFontSize * lineHeightFactor
  const totalHeight = nameLineHeight + stackedTextGapPx + valueLineHeight
  const startY = centerY - totalHeight / 2

  return {
    nameY: startY + nameLineHeight * 0.8,
    valueY: startY + nameLineHeight + stackedTextGapPx + valueLineHeight * 0.8,
  }
}

const getCurrentSettings = (): ChartRenderSettings => ({
  barHeightPx: barHeightPx.value,
  labelLayoutMode: labelLayoutMode.value,
  nameFontSizePx: nameFontSizePx.value,
  valueFontSizePx: valueFontSizePx.value,
  labelColor: labelColor.value,
})

const getChartDimensions = () => {
  const containerWidth = svgRef.value?.clientWidth ?? 860
  return {
    width: Math.max(320, containerWidth),
    height: 500,
  }
}

const getChartMargins = (settings: ChartRenderSettings, rawData: RawDataItem[]) => {
  const maxNameLength = rawData.reduce((max, item) => Math.max(max, item.name.length), 0)
  const estimatedNameWidth = Math.ceil(maxNameLength * settings.nameFontSizePx * 0.55)

  const left =
    settings.labelLayoutMode === 'mode1'
      ? Math.max(24, Math.min(estimatedNameWidth + 16, 150))
      : 16
  const right = settings.labelLayoutMode === 'mode1' ? 56 : 16

  return { top: 48, right, bottom: 30, left }
}

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
  if (!svgRef.value) return

  const svg = d3.select(svgRef.value)
  svg.selectAll('*').remove()

  if (rawData.length === 0) return

  const { width, height } = getChartDimensions()
  const previewSettings = getCurrentSettings()
  const margin = getChartMargins(previewSettings, rawData)
  const barHeight = barHeightPx.value
  const topN = 8

  svg.attr('viewBox', `0 0 ${width} ${height}`)

  const firstPeriod = rawData[0]?.period
  const currentRows = rawData
    .filter((d) => d.period === firstPeriod)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN)

  if (currentRows.length === 0) return

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(currentRows, (d) => d.value) ?? 1])
    .range([margin.left, width - margin.right])

  const y = d3
    .scaleBand<number>()
    .domain(d3.range(currentRows.length))
    .range([margin.top, margin.top + barHeight * currentRows.length])
    .padding(0.2)

  const axisY = margin.top - 10

  const axis = svg
    .append('g')
    .attr('transform', `translate(0, ${axisY})`)
    .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0))

  axis.select('.domain').remove()
  axis.selectAll('.tick line').remove()
  axis.selectAll('.tick text').attr('fill', '#334155').style('font-size', '12px')

  const barsGroup = svg.append('g')
  const labelsGroup = svg.append('g')

  barsGroup
    .selectAll<SVGRectElement, RawDataItem>('rect')
    .data(currentRows)
    .join('rect')
    .attr('x', margin.left)
    .attr('y', (_, index) => y(index) ?? margin.top)
    .attr('height', y.bandwidth())
    .attr('width', (d) => x(d.value) - margin.left)
    .attr('fill', (d) => getBarColor(d.name))

  const barGridGroup = svg.append('g').style('pointer-events', 'none')
  const barGridData = currentRows.flatMap((row, index) =>
    x
      .ticks(5)
      .filter((tick) => tick > 0 && tick < row.value)
      .map((tick) => ({ key: `${row.name}-${tick}`, tick, index })),
  )

  barGridGroup
    .selectAll<SVGLineElement, { key: string; tick: number; index: number }>('line.value-grid')
    .data(barGridData, (d) => d.key)
    .join('line')
    .attr('class', 'value-grid')
    .attr('x1', (d) => x(d.tick))
    .attr('x2', (d) => x(d.tick))
    .attr('y1', (d) => y(d.index) ?? margin.top)
    .attr('y2', (d) => (y(d.index) ?? margin.top) + y.bandwidth())
    .attr('stroke', '#ffffff')
    .attr('stroke-opacity', 0.55)

  const labels = labelsGroup
    .selectAll<SVGGElement, RawDataItem>('g.preview-label')
    .data(currentRows)
    .join('g')
    .attr('class', 'preview-label')

  labels.each(function (d, index) {
    const group = d3.select(this)
    group.selectAll('*').remove()

    const center = (y(index) ?? margin.top) + y.bandwidth() / 2
    const barEnd = x(d.value)

    if (labelLayoutMode.value === 'mode1') {
      group
        .append('text')
        .attr('x', margin.left - 6)
        .attr('y', center)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', labelColor.value)
        .style('font-size', `${nameFontSizePx.value}px`)
        .style('font-weight', '700')
        .text(d.name)
      group
        .append('text')
        .attr('x', barEnd + 6)
        .attr('y', center)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', labelColor.value)
        .style('font-size', `${valueFontSizePx.value}px`)
        .style('font-weight', '600')
        .text(d.value.toFixed(0))
    } else if (labelLayoutMode.value === 'mode2') {
      group
        .append('text')
        .attr('x', margin.left + 8)
        .attr('y', center)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', labelColor.value)
        .style('font-size', `${nameFontSizePx.value}px`)
        .style('font-weight', '700')
        .text(d.name)
      group
        .append('text')
        .attr('x', barEnd - 8)
        .attr('y', center)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', labelColor.value)
        .style('font-size', `${valueFontSizePx.value}px`)
        .style('font-weight', '600')
        .text(d.value.toFixed(0))
    } else if (labelLayoutMode.value === 'mode3') {
      const { nameY, valueY } = getStackedLabelY(center, nameFontSizePx.value, valueFontSizePx.value)
      group
        .append('text')
        .attr('x', barEnd - 8)
        .attr('y', nameY)
        .attr('text-anchor', 'end')
        .attr('fill', labelColor.value)
        .style('font-size', `${nameFontSizePx.value}px`)
        .style('font-weight', '700')
        .text(d.name)
      group
        .append('text')
        .attr('x', barEnd - 8)
        .attr('y', valueY)
        .attr('text-anchor', 'end')
        .attr('fill', labelColor.value)
        .style('font-size', `${valueFontSizePx.value}px`)
        .style('font-weight', '600')
        .text(d.value.toFixed(0))
    } else {
      const { nameY, valueY } = getStackedLabelY(center, nameFontSizePx.value, valueFontSizePx.value)
      group
        .append('text')
        .attr('x', margin.left + 8)
        .attr('y', nameY)
        .attr('text-anchor', 'start')
        .attr('fill', labelColor.value)
        .style('font-size', `${nameFontSizePx.value}px`)
        .style('font-weight', '700')
        .text(d.name)
      group
        .append('text')
        .attr('x', margin.left + 8)
        .attr('y', valueY)
        .attr('text-anchor', 'start')
        .attr('fill', labelColor.value)
        .style('font-size', `${valueFontSizePx.value}px`)
        .style('font-weight', '600')
        .text(d.value.toFixed(0))
    }
  })

  svg
    .append('text')
    .attr('x', margin.left)
    .attr('y', 28)
    .attr('text-anchor', 'start')
    .attr('class', 'fill-slate-600 text-3xl font-semibold')
    .text(firstPeriod)
}

const runBarChartRace = async (rawData: RawDataItem[], settings: ChartRenderSettings) => {
  if (!svgRef.value) return

  const svg = d3.select(svgRef.value)
  svg.selectAll('*').remove()

  const { width, height } = getChartDimensions()
  const margin = getChartMargins(settings, rawData)
  const barHeight = settings.barHeightPx
  const topN = 8
  const frameDuration = 1000
  const valueDuration = 1000
  svg.attr('viewBox', `0 0 ${width} ${height}`)

  const periods = Array.from(new Set(rawData.map((d: RawDataItem) => d.period)))
  const names = Array.from(new Set(rawData.map((d: RawDataItem) => d.name)))
  const periodMap = d3.group(rawData, (d: RawDataItem) => d.period)

  const rankedByPeriod = periods.map((period) => {
    const current: RawDataItem[] = periodMap.get(period) ?? []
    const values = new Map<string, number>(current.map((d: RawDataItem) => [d.name, d.value]))
    const rows: RankedItem[] = names
      .map((name) => ({ name, value: values.get(name) ?? 0, rank: 0 }))
      .sort((a: RankedItem, b: RankedItem) => b.value - a.value)
      .slice(0, topN)
      .map((item, index) => ({ ...item, rank: index }))
    return { period, rows }
  })

  const maxValue = d3.max(rankedByPeriod.flatMap((d) => d.rows.map((r) => r.value))) ?? 1

  const x = d3
    .scaleLinear()
    .domain([0, maxValue])
    .range([margin.left, width - margin.right])

  const y = d3
    .scaleBand<number>()
    .domain(d3.range(topN))
    .range([margin.top, margin.top + barHeight * topN])
    .padding(0.2)

  const axisY = margin.top - 10

  const axis = svg
    .append('g')
    .attr('transform', `translate(0, ${axisY})`)
    .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0))
    .call((g: d3.Selection<SVGGElement, unknown, null, undefined>) =>
      g.select('.domain').attr('opacity', 0.3),
    )

  axis.select('.domain').remove()
  axis.selectAll('.tick line').remove()
  axis.selectAll('.tick text').attr('fill', '#334155').style('font-size', '12px')

  const renderGrid = (rows: RankedItem[]) => {
    const barGridData = rows.flatMap((row) =>
      x
        .ticks(5)
        .filter((tick) => tick > 0 && tick < row.value)
        .map((tick) => ({ key: `${row.name}-${tick}`, tick, rank: row.rank })),
    )

    barGridGroup
      .selectAll<SVGLineElement, { key: string; tick: number; rank: number }>('line.value-grid')
      .data(barGridData, (d) => d.key)
      .join('line')
      .attr('class', 'value-grid')
      .attr('x1', (d) => x(d.tick))
      .attr('x2', (d) => x(d.tick))
      .attr('y1', (d) => y(d.rank) ?? margin.top)
      .attr('y2', (d) => (y(d.rank) ?? margin.top) + y.bandwidth())
      .attr('stroke', '#ffffff')
      .attr('stroke-opacity', 0.55)
  }

  const barsGroup = svg.append('g')
  const barGridGroup = svg.append('g').style('pointer-events', 'none')
  const labelsGroup = svg.append('g')

  renderGrid(rankedByPeriod[0]?.rows ?? [])

  const periodLabel = svg
    .append('text')
    .attr('x', margin.left)
    .attr('y', 28)
    .attr('text-anchor', 'start')
    .attr('class', 'fill-slate-600 text-3xl font-semibold')

  let isFirstFrame = true

  for (const frame of rankedByPeriod) {
    const t = d3.transition().duration(frameDuration).ease(d3.easeLinear)

    x.domain([0, d3.max(frame.rows, (d: RankedItem) => d.value) ?? 1])
    axis.transition(t).call(d3.axisBottom(x).ticks(5).tickSizeOuter(0))
    axis.select('.domain').remove()
    axis.selectAll('.tick line').remove()
    axis.selectAll('.tick text').attr('fill', '#334155').style('font-size', '12px')
    renderGrid(frame.rows)

    const bars = barsGroup
      .selectAll<SVGRectElement, RankedItem>('rect')
      .data(frame.rows, (d: RankedItem) => d.name)

    bars
      .join(
        (enter: d3.Selection<d3.EnterElement, RankedItem, SVGGElement, unknown>) =>
          enter
            .append('rect')
            .attr('x', margin.left)
            .attr('y', (d: RankedItem) => y(d.rank) ?? margin.top)
            .attr('height', y.bandwidth())
            .attr('width', (d: RankedItem) => (isFirstFrame ? x(d.value) - margin.left : 0))
            .attr('fill', (d: RankedItem) => getBarColor(d.name)),
        (update: d3.Selection<SVGRectElement, RankedItem, SVGGElement, unknown>) => update,
        (exit: d3.Selection<SVGRectElement, RankedItem, SVGGElement, unknown>) =>
          exit.transition(t).attr('width', 0).remove(),
      )
    if (isFirstFrame) {
      bars
        .attr('y', (d: RankedItem) => y(d.rank) ?? margin.top)
        .attr('width', (d: RankedItem) => x(d.value) - margin.left)
        .attr('fill', (d: RankedItem) => getBarColor(d.name))
    } else {
      bars
        .transition(t)
        .attr('y', (d: RankedItem) => y(d.rank) ?? margin.top)
        .attr('width', (d: RankedItem) => x(d.value) - margin.left)
        .attr('fill', (d: RankedItem) => getBarColor(d.name))
    }

    const labels = labelsGroup
      .selectAll<SVGGElement, RankedItem>('g.bar-label')
      .data(frame.rows, (d: RankedItem) => d.name)

    labels
      .join(
        (enter: d3.Selection<d3.EnterElement, RankedItem, SVGGElement, unknown>) =>
          enter
            .append('g')
            .attr('class', 'bar-label')
            .call((group) => {
              const getNameX = (d: RankedItem) => {
                const barEnd = x(d.value)
                if (settings.labelLayoutMode === 'mode1') return margin.left - 6
                if (settings.labelLayoutMode === 'mode2') return margin.left + 8
                if (settings.labelLayoutMode === 'mode3') return barEnd - 8
                return margin.left + 8
              }
              const getValueX = (d: RankedItem) => {
                const barEnd = x(d.value)
                if (settings.labelLayoutMode === 'mode1') return barEnd + 6
                if (settings.labelLayoutMode === 'mode2') return barEnd - 8
                if (settings.labelLayoutMode === 'mode3') return barEnd - 8
                return margin.left + 8
              }
              const getNameY = (d: RankedItem) => {
                const center = (y(d.rank) ?? margin.top) + y.bandwidth() / 2
                if (settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4') {
                  return getStackedLabelY(center, settings.nameFontSizePx, settings.valueFontSizePx).nameY
                }
                return center
              }
              const getValueY = (d: RankedItem) => {
                const center = (y(d.rank) ?? margin.top) + y.bandwidth() / 2
                if (settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4') {
                  return getStackedLabelY(center, settings.nameFontSizePx, settings.valueFontSizePx).valueY
                }
                return center
              }
              const getNameAnchor = () => {
                if (settings.labelLayoutMode === 'mode1') return 'end'
                if (settings.labelLayoutMode === 'mode3') return 'end'
                return 'start'
              }
              const getValueAnchor = () => {
                if (settings.labelLayoutMode === 'mode1') return 'start'
                if (settings.labelLayoutMode === 'mode2') return 'end'
                if (settings.labelLayoutMode === 'mode3') return 'end'
                return 'start'
              }
              const getDy = () =>
                settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4'
                  ? '0em'
                  : '0.35em'

              group
                .append('text')
                .attr('class', 'name-label')
                .attr('x', getNameX)
                .attr('y', getNameY)
                .attr('dy', getDy())
                .attr('text-anchor', getNameAnchor())
                .attr('fill', settings.labelColor)
                .style('font-size', `${settings.nameFontSizePx}px`)
                .style('font-weight', '700')
                .text((d: RankedItem) => d.name)
              group
                .append('text')
                .attr('class', 'value-label')
                .attr('x', getValueX)
                .attr('y', getValueY)
                .attr('dy', getDy())
                .attr('text-anchor', getValueAnchor())
                .attr('fill', settings.labelColor)
                .style('font-size', `${settings.valueFontSizePx}px`)
                .style('font-weight', '600')
                .text((d: RankedItem) => d.value.toFixed(0))
            }),
        (update: d3.Selection<SVGGElement, RankedItem, SVGGElement, unknown>) => update,
        (exit: d3.Selection<SVGGElement, RankedItem, SVGGElement, unknown>) => exit.remove(),
      )

    const nameTexts = labels.select<SVGTextElement>('text.name-label')
    const valueTexts = labels.select<SVGTextElement>('text.value-label')

    const applyNamePosition = (selection: any) =>
      selection
      .attr('x', (d: RankedItem) => {
        const barEnd = x(d.value)
        if (settings.labelLayoutMode === 'mode1') return margin.left - 6
        if (settings.labelLayoutMode === 'mode2') return margin.left + 8
        if (settings.labelLayoutMode === 'mode3') return barEnd - 8
        return margin.left + 8
      })
      .attr('y', (d: RankedItem) => {
        const center = (y(d.rank) ?? margin.top) + y.bandwidth() / 2
        if (settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4') {
          return getStackedLabelY(center, settings.nameFontSizePx, settings.valueFontSizePx).nameY
        }
        return center
      })
      .attr('dy', () =>
        settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4' ? '0em' : '0.35em',
      )
      .attr('text-anchor', () => {
        if (settings.labelLayoutMode === 'mode1') return 'end'
        if (settings.labelLayoutMode === 'mode3') return 'end'
        return 'start'
      })
      .attr('fill', settings.labelColor)
      .style('font-size', `${settings.nameFontSizePx}px`)
      .style('font-weight', '700')
      .text((d: RankedItem) => d.name)

    const applyValuePosition = (selection: any) =>
      selection
      .attr('x', (d: RankedItem) => {
        const barEnd = x(d.value)
        if (settings.labelLayoutMode === 'mode1') return barEnd + 6
        if (settings.labelLayoutMode === 'mode2') return barEnd - 8
        if (settings.labelLayoutMode === 'mode3') return barEnd - 8
        return margin.left + 8
      })
      .attr('y', (d: RankedItem) => {
        const center = (y(d.rank) ?? margin.top) + y.bandwidth() / 2
        if (settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4') {
          return getStackedLabelY(center, settings.nameFontSizePx, settings.valueFontSizePx).valueY
        }
        return center
      })
      .attr('dy', () =>
        settings.labelLayoutMode === 'mode3' || settings.labelLayoutMode === 'mode4' ? '0em' : '0.35em',
      )
      .attr('text-anchor', () => {
        if (settings.labelLayoutMode === 'mode1') return 'start'
        if (settings.labelLayoutMode === 'mode2') return 'end'
        if (settings.labelLayoutMode === 'mode3') return 'end'
        return 'start'
      })
      .attr('fill', settings.labelColor)
      .style('font-size', `${settings.valueFontSizePx}px`)
      .style('font-weight', '600')

    if (isFirstFrame) {
      applyNamePosition(nameTexts)
      applyValuePosition(valueTexts).text((d: RankedItem) => d.value.toFixed(0))
    } else {
      applyNamePosition(nameTexts.transition(t))
      applyValuePosition(
        valueTexts
          .transition()
          .duration(valueDuration)
          .ease(d3.easeLinear),
      ).tween('text', function (this: SVGTextElement, d: RankedItem) {
        const node = this as SVGTextElement
        const previous = Number(node.textContent?.replace(/[^\d.]/g, '') ?? 0)
        const interpolator = d3.interpolateNumber(previous, d.value)
        return (time: number) => {
          node.textContent = interpolator(time).toFixed(0)
        }
      })
    }

    periodLabel.text(frame.period)
    await t.end()
    isFirstFrame = false
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
    isAnimating.value = true
    const settings = getCurrentSettings()
    await runBarChartRace(data, settings)
    isAnimating.value = false
    startTimeout = null
  }, 5000)
}

onBeforeUnmount(() => {
  clearTimers()
  window.removeEventListener('resize', handleWindowResize)
})

const handleWindowResize = () => {
  if (isAnimating.value || countdown.value !== null) return
  renderPreviewChart(collectDataForPreview())
}

watch(
  [periods, names, labelLayoutMode, barHeightPx, nameFontSizePx, valueFontSizePx, labelColor],
  () => {
    if (isAnimating.value || countdown.value !== null) return
    renderPreviewChart(collectDataForPreview())
  },
  { deep: true },
)

onMounted(() => {
  renderPreviewChart(collectDataForPreview())
  window.addEventListener('resize', handleWindowResize)
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

        <div class="mb-4">
          <label class="mb-2 block text-sm font-medium">Отображение текста на барах</label>
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

      <section class="rounded-2xl bg-white p-6 shadow-sm">
        <h2 class="text-xl font-bold">{{ chartTitle || 'Без названия' }}</h2>
        <p v-if="chartDescription" class="mt-1 text-sm text-slate-600">{{ chartDescription }}</p>
        <svg ref="svgRef" class="mt-4 h-[520px] w-full rounded-lg border border-slate-200 bg-slate-50"></svg>
      </section>
    </div>
  </main>
</template>
