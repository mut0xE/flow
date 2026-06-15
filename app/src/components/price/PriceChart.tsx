"use client"
import { useEffect, useRef } from "react"
import { createChart, IChartApi, LineData, UTCTimestamp, LineSeries } from "lightweight-charts"

interface PriceChartProps {
  price: number | null
  startPrice?: number | null
}

export function PriceChart({ price, startPrice }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<any>(null)
  const pointsRef = useRef<LineData[]>([])
  const seededRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      width: containerRef.current.clientWidth,
      height: 240,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,       // keep a little breathing room on the right
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        autoScale: true,
      },
      handleScroll: true,
      handleScale: true,
    })
    const series = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: true,
      crosshairMarkerVisible: true,
    })
    chartRef.current = chart
    seriesRef.current = series

    const container = containerRef.current
    const ro = new ResizeObserver(() => {
      if (chartRef.current && container) {
        chartRef.current.applyOptions({ width: container.clientWidth })
      }
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      seriesRef.current = null
      chartRef.current = null
      chart.remove()
    }
  }, [])

  // Seed a flat baseline from startPrice so chart isn't blank while WS connects
  useEffect(() => {
    if (seededRef.current || !startPrice || !seriesRef.current || !chartRef.current) return
    seededRef.current = true
    const now = Math.floor(Date.now() / 1000) as UTCTimestamp
    // Seed 10s of flat history so chart has a baseline to show
    const seed: LineData[] = Array.from({ length: 10 }, (_, i) => ({
      time: (now - 10 + i) as UTCTimestamp,
      value: startPrice,
    }))
    pointsRef.current = seed
    seriesRef.current.setData(seed)
    chartRef.current.timeScale().scrollToRealTime()
  }, [startPrice])

  useEffect(() => {
    if (price === null || !seriesRef.current || !chartRef.current) return

    const t = Math.floor(Date.now() / 1000) as UTCTimestamp
    const points = pointsRef.current
    const point: LineData = { time: t, value: price }

    if (points.length > 0 && (points[points.length - 1].time as number) === t) {
      points[points.length - 1] = point
      seriesRef.current.update(point)
    } else {
      points.push(point)
      if (points.length > 300) points.splice(0, points.length - 300)
      seriesRef.current.update(point)
    }

    // Keep latest price visible — only scrolls if user hasn't manually panned away
    chartRef.current.timeScale().scrollToRealTime()
  }, [price])

  return <div ref={containerRef} className="w-full rounded border border-gray-800" />
}
