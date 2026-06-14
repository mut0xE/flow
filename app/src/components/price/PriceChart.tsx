"use client"
import { useEffect, useRef, useState } from "react"
import { createChart, IChartApi, LineData, UTCTimestamp, LineSeries } from "lightweight-charts"

interface PriceChartProps {
  price: number | null
  startPrice?: number | null
}

export function PriceChart({ price }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<any>(null)
  const [, setPoints] = useState<LineData[]>([])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      width: containerRef.current.clientWidth,
      height: 240,
      timeScale: { timeVisible: true, secondsVisible: true },
    })
    const series = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 2,
    })
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [])

  useEffect(() => {
    if (price === null || !seriesRef.current) return
    const point: LineData = { time: Math.floor(Date.now() / 1000) as UTCTimestamp, value: price }
    setPoints(prev => {
      const updated = [...prev, point]
      const deduplicated: LineData[] = []
      const seen = new Set<number>()
      for (const p of updated) {
        const t = p.time as number
        if (!seen.has(t)) { seen.add(t); deduplicated.push(p) }
        else { deduplicated[deduplicated.length - 1] = p }
      }
      const recent = deduplicated.slice(-300)
      seriesRef.current?.setData(recent)
      return recent
    })
  }, [price])

  return <div ref={containerRef} className="w-full rounded border border-gray-800" />
}
