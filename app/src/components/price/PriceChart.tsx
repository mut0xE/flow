"use client"
import { useEffect, useRef } from "react"
import { createChart, IChartApi, LineData, UTCTimestamp, LineSeries, LineStyle, LineType, LastPriceAnimationMode } from "lightweight-charts"

interface PriceChartProps {
  price: number | null
  startPrice?: number | null
}

const SEED_SECS = 120

export function PriceChart({ price, startPrice }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<any>(null)
  const pointsRef = useRef<LineData[]>([])
  const seededRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#ede5f5" }, textColor: "#7a6a8a" },
      grid: {
        vertLines: { color: "#e0d6f0", style: LineStyle.Dotted },
        horzLines: { color: "#d8cde8", style: LineStyle.Dotted },
      },
      width: containerRef.current.clientWidth,
      height: 220,
      timeScale: {
        visible: true,
        borderColor: "#c4b8d8",
        timeVisible: true,
        secondsVisible: true,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        visible: true,
        borderColor: "#c4b8d8",
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      leftPriceScale: { visible: false },
      crosshair: {
        horzLine: { visible: true, labelVisible: true, color: "#9b8ab4", width: 1, style: LineStyle.Dashed },
        vertLine: { visible: true, labelVisible: true, color: "#9b8ab4", width: 1, style: LineStyle.Dashed },
      },
      handleScroll: false,
      handleScale: false,
    })

    const series = chart.addSeries(LineSeries, {
      color: "#5b2d8e",
      lineWidth: 2,
      lineType: LineType.Curved,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#5b2d8e",
      crosshairMarkerBackgroundColor: "#ede5f5",
      lastPriceAnimation: LastPriceAnimationMode.Continuous,
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

  // Seed flat baseline so chart fills immediately while WebSocket connects
  useEffect(() => {
    if (seededRef.current || !startPrice || !seriesRef.current || !chartRef.current) return
    seededRef.current = true
    const now = Math.floor(Date.now() / 1000) as UTCTimestamp
    const seed: LineData[] = Array.from({ length: SEED_SECS }, (_, i) => ({
      time: (now - SEED_SECS + i) as UTCTimestamp,
      value: startPrice,
    }))
    pointsRef.current = seed
    seriesRef.current.setData(seed)
    // fitContent once so the full seed window fills the chart width
    chartRef.current.timeScale().fitContent()
  }, [startPrice])

  useEffect(() => {
    if (price === null || !seriesRef.current || !chartRef.current) return

    const t = Math.floor(Date.now() / 1000) as UTCTimestamp
    const points = pointsRef.current
    const point: LineData = { time: t, value: price }

    if (points.length > 0 && (points[points.length - 1].time as number) === t) {
      points[points.length - 1] = point
    } else {
      points.push(point)
      if (points.length > 600) points.splice(0, points.length - 600)
    }

    seriesRef.current.update(point)
    // scrollToRealTime is optimised for live streaming — no layout recalculation
    chartRef.current.timeScale().scrollToRealTime()
  }, [price])

  return (
    <div style={{ position: "relative" }}>
      {startPrice != null && (
        <div style={{
          position: "absolute", top: 8, left: 10, zIndex: 10,
          fontFamily: "'VT323', monospace", fontSize: 15,
          color: "#3d2e52", letterSpacing: 1, pointerEvents: "none",
        }}>
          START ${startPrice.toFixed(2)}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: 220 }} />
    </div>
  )
}
