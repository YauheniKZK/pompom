import * as d3 from 'd3'

export type RawRaceRow = {
  name: string
  value: number
  period: string
}

export type RankedRow = {
  name: string
  value: number
  rank: number
}

export type ExplainedChartOptions = {
  width: number
  topN: number
  barSize: number
  durationMs: number
  keyframeSteps: number
  margin: { top: number; right: number; bottom: number; left: number }
  color: (name: string) => string
  /** Цвет подписей имени и значения (как в форме) */
  labelFill: string
}

/** D3: дочерний transition наследует родительский — ослабляем тип для TS */
function inheritTransition(
  parent: d3.Transition<SVGSVGElement, unknown, null, undefined>,
): d3.Transition<d3.BaseType, unknown, null, undefined> {
  return parent as unknown as d3.Transition<d3.BaseType, unknown, null, undefined>
}

export function sortedPeriodsFromRaw(raw: RawRaceRow[]): string[] {
  const unique = [...new Set(raw.map((d) => d.period))]
  return unique.sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b, undefined, { numeric: true })
  })
}

export function allNames(raw: RawRaceRow[]): Set<string> {
  return new Set(raw.map((d) => d.name))
}

export function datevalues(
  raw: RawRaceRow[],
  periodsOrdered: string[],
): [Date, Map<string, number>][] {
  const byPeriod = d3.group(raw, (d) => d.period)
  return periodsOrdered.map((period, i) => {
    const rows = byPeriod.get(period) ?? []
    const m = new Map(rows.map((r) => [r.name, r.value]))
    return [new Date(2000 + i, 0, 1), m] as [Date, Map<string, number>]
  })
}

export function rankFactory(names: Set<string>, n: number) {
  return function rank(value: (name: string) => number): RankedRow[] {
    const data: RankedRow[] = Array.from(names, (name) => ({
      name,
      value: value(name),
      rank: 0,
    }))
    data.sort((a, b) => d3.descending(a.value, b.value))
    for (let i = 0; i < data.length; ++i) data[i].rank = Math.min(n, i)
    return data
  }
}

export function buildKeyframes(
  datevals: [Date, Map<string, number>][],
  k: number,
  rank: (value: (name: string) => number) => RankedRow[],
): [Date, RankedRow[]][] {
  const keyframes: [Date, RankedRow[]][] = []

  for (const [[ka0, a], [kb0, b0]] of d3.pairs(datevals)) {
    const ka = +ka0
    const kb = +kb0
    for (let i = 0; i < k; ++i) {
      const t = i / k
      keyframes.push([
        new Date(ka * (1 - t) + kb * t),
        rank((name) => (a.get(name) ?? 0) * (1 - t) + (b0.get(name) ?? 0) * t),
      ])
    }
  }
  const last = datevals[datevals.length - 1]!
  keyframes.push([last[0], rank((name) => last[1].get(name) ?? 0)])
  return keyframes
}

/** Период для подписи тикера по дате кадра (как в Observable — «текущий» момент времени) */
export function periodLabelForKeyframeDate(
  date: Date,
  datevals: [Date, Map<string, number>][],
  periodsOrdered: string[],
): string {
  if (periodsOrdered.length === 0) return ''
  const t = +date
  let idx = 0
  for (let j = 0; j < datevals.length; j++) {
    if (+datevals[j]![0] <= t) idx = j
  }
  return periodsOrdered[idx] ?? ''
}

export function nameframes(keyframes: [Date, RankedRow[]][]) {
  return d3.groups(keyframes.flatMap(([, data]) => data), (d) => d.name)
}

export function prevNextMaps(nf: [string, RankedRow[]][]): {
  prev: Map<RankedRow, RankedRow>
  next: Map<RankedRow, RankedRow>
} {
  const prev = new Map(
    nf.flatMap(([, data]) => d3.pairs(data, (a, b) => [b, a] as [RankedRow, RankedRow])),
  )
  const next = new Map(nf.flatMap(([, data]) => d3.pairs(data)))
  return { prev, next }
}

export function chartHeight(margin: { top: number; bottom: number }, barSize: number, n: number) {
  return margin.top + barSize * n + margin.bottom
}

export function makeScales(
  width: number,
  margin: { left: number; right: number; top: number },
  barSize: number,
  n: number,
) {
  const x = d3.scaleLinear([0, 1], [margin.left, width - margin.right])
  const y = d3
    .scaleBand()
    .domain(d3.range(n + 1).map(String))
    .rangeRound([margin.top, margin.top + barSize * (n + 1 + 0.1)])
    .padding(0.1)
  return { x, y }
}

export function bars(
  n: number,
  color: (d: RankedRow) => string,
  y: d3.ScaleBand<string>,
  x: d3.ScaleLinear<number, number>,
  prev: Map<RankedRow, RankedRow>,
  next: Map<RankedRow, RankedRow>,
) {
  return function barsComponent(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
    let bar = svg
      .append('g')
      .attr('fill-opacity', 0.6)
      .selectAll<SVGRectElement, RankedRow>('rect')

    return function update(
      keyframe: [Date, RankedRow[]],
      transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
    ) {
      const sub = inheritTransition(transition)
      const [, data] = keyframe
      bar = bar
        .data(data.slice(0, n), (d) => d.name)
        .join(
          (enter) =>
            enter
              .append('rect')
              .attr('fill', (d) => color(d))
              .attr('height', y.bandwidth())
              .attr('x', x(0))
              .attr('y', (d) => y(String((prev.get(d) ?? d).rank))!)
              .attr('width', (d) => x((prev.get(d) ?? d).value) - x(0)),
          (update) => update,
          (exit) =>
            exit
              .transition(sub)
              .remove()
              .attr('y', (d) => y(String((next.get(d) ?? d).rank))!)
              .attr('width', (d) => x((next.get(d) ?? d).value) - x(0)),
        )
        .call((sel) =>
          sel
            .transition(sub)
            .attr('y', (d) => y(String(d.rank))!)
            .attr('width', (d) => x(d.value) - x(0)),
        )
      return bar
    }
  }
}

export function labels(
  n: number,
  x: d3.ScaleLinear<number, number>,
  prev: Map<RankedRow, RankedRow>,
  y: d3.ScaleBand<string>,
  next: Map<RankedRow, RankedRow>,
  formatNumber: (n: number) => string,
  labelFont: string,
  labelFill: string,
) {
  return function labelsComponent(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
    let label = svg
      .append('g')
      .style('font', labelFont)
      .style('font-variant-numeric', 'tabular-nums')
      .attr('text-anchor', 'end')
      .selectAll<SVGTextElement, RankedRow>('text')

    return function update(
      keyframe: [Date, RankedRow[]],
      transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
    ) {
      const sub = inheritTransition(transition)
      const [, data] = keyframe
      label = label
        .data(data.slice(0, n), (d) => d.name)
        .join(
          (enter) =>
            enter
              .append('text')
              .attr('fill', labelFill)
              .attr(
                'transform',
                (d) =>
                  `translate(${x((prev.get(d) ?? d).value)},${y(String((prev.get(d) ?? d).rank))})`,
              )
              .attr('y', y.bandwidth() / 2)
              .attr('x', -6)
              .attr('dy', '-0.25em')
              .text((d) => d.name)
              .call((text) =>
                text
                  .append('tspan')
                  .attr('fill', labelFill)
                  .attr('fill-opacity', 0.7)
                  .attr('font-weight', 'normal')
                  .attr('x', -6)
                  .attr('dy', '1.15em'),
              ),
          (update) => update,
          (exit) =>
            exit
              .transition(sub)
              .remove()
              .attr(
                'transform',
                (d) =>
                  `translate(${x((next.get(d) ?? d).value)},${y(String((next.get(d) ?? d).rank))})`,
              )
              .call((g) =>
                g.select('tspan').textTween(
                  (d) =>
                    ((t: number) =>
                      String(
                        Math.round(
                          d3.interpolateNumber(d.value, (next.get(d) ?? d).value)(t),
                        ),
                      )) as unknown as (t: number) => string,
                ),
              ),
        )
        .call((sel) =>
          sel
            .transition(sub)
            .attr('transform', (d) => `translate(${x(d.value)},${y(String(d.rank))})`)
            .call((g) =>
              g.select('tspan').textTween((d) => {
                const i = d3.interpolateNumber((prev.get(d) ?? d).value, d.value)
                return (t: number) => formatNumber(i(t))
              }),
            ),
        )
      return label
    }
  }
}

export function axis(
  margin: { top: number },
  x: d3.ScaleLinear<number, number>,
  width: number,
  barSize: number,
  n: number,
  y: d3.ScaleBand<string>,
) {
  return function axisComponent(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
    const g = svg.append('g').attr('transform', `translate(0,${margin.top})`)
    const axisTop = d3
      .axisTop(x)
      .ticks(width / 160)
      .tickSizeOuter(0)
      .tickSizeInner(-barSize * (n + y.padding()))

    return function update(
      _: [Date, RankedRow[]],
      transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
    ) {
      g.transition(inheritTransition(transition)).call(axisTop)
      g.select('.tick:first-of-type text').remove()
      g.selectAll('.tick:not(:first-of-type) line').attr('stroke', 'white')
      g.select('.domain').remove()
    }
  }
}

export function ticker(
  barSize: number,
  width: number,
  margin: { top: number },
  n: number,
  initialLabel: string,
) {
  return function tickerComponent(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
    const now = svg
      .append('text')
      .style('font', `bold ${barSize}px var(--sans-serif, ui-sans-serif, system-ui, sans-serif)`)
      .style('font-variant-numeric', 'tabular-nums')
      .attr('text-anchor', 'end')
      .attr('x', width - 6)
      .attr('y', margin.top + barSize * (n - 0.45))
      .attr('dy', '0.32em')
      .text(initialLabel)

    return function update(
      _: [Date, RankedRow[]],
      transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
      periodLabel: string,
    ) {
      void transition.end().then(() => {
        now.text(periodLabel)
      })
    }
  }
}

export type ExplainedRenderContext = {
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>
  width: number
  height: number
  keyframes: [Date, RankedRow[]][]
  updateBars: ReturnType<ReturnType<typeof bars>>
  updateAxis: ReturnType<ReturnType<typeof axis>>
  updateLabels: ReturnType<ReturnType<typeof labels>>
  updateTicker: ReturnType<ReturnType<typeof ticker>>
  x: d3.ScaleLinear<number, number>
}

export function createExplainedContext(
  svgEl: SVGSVGElement,
  keyframes: [Date, RankedRow[]][],
  periodsOrdered: string[],
  options: ExplainedChartOptions,
  labelFont: string,
): ExplainedRenderContext | null {
  if (keyframes.length === 0) return null

  const { width, topN: n, barSize, margin } = options
  const height = chartHeight(margin, barSize, n)
  const { x, y } = makeScales(width, margin, barSize, n)
  const nf = nameframes(keyframes)
  const { prev, next } = prevNextMaps(nf)
  const formatNumber = d3.format(',d')

  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()
  svg.attr('viewBox', `0 0 ${width} ${height}`)

  const colorFn = (d: RankedRow) => options.color(d.name)

  const updateBars = bars(n, colorFn, y, x, prev, next)(svg)
  const updateAxis = axis(margin, x, width, barSize, n, y)(svg)
  const updateLabels = labels(n, x, prev, y, next, formatNumber, labelFont, options.labelFill)(svg)
  const updateTicker = ticker(barSize, width, margin, n, periodsOrdered[0] ?? '')(svg)

  return {
    svg,
    width,
    height,
    keyframes,
    updateBars,
    updateAxis,
    updateLabels,
    updateTicker,
    x,
  }
}

export function renderExplainedFrame(
  ctx: ExplainedRenderContext,
  keyframe: [Date, RankedRow[]],
  transition: d3.Transition<SVGSVGElement, unknown, null, undefined>,
  tickerLabel: string,
) {
  const { x } = ctx
  x.domain([0, keyframe[1][0]?.value ?? 1])
  ctx.updateAxis(keyframe, transition)
  ctx.updateBars(keyframe, transition)
  ctx.updateLabels(keyframe, transition)
  ctx.updateTicker(keyframe, transition, tickerLabel)
}
