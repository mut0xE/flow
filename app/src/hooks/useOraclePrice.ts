"use client"
import { useEffect, useState } from "react"
import { ORACLE_SOL_USD, parseOraclePrice } from "@/lib/oracle"

// Module-level singleton — survives component unmount/remount and page navigation
let singletonWs: WebSocket | null = null
let singletonPrice: number | null = null
const listeners = new Set<(price: number) => void>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function notifyListeners(price: number) {
  singletonPrice = price
  listeners.forEach((fn) => fn(price))
}

function startSingleton() {
  if (singletonWs && singletonWs.readyState !== WebSocket.CLOSED) return

  const ws = new WebSocket("wss://devnet.magicblock.app")
  singletonWs = ws

  ws.onopen = () => {
    ws.send(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "accountSubscribe",
      params: [ORACLE_SOL_USD.toBase58(), { encoding: "base64", commitment: "confirmed" }],
    }))
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.method === "accountNotification") {
        const encoded = msg.params?.result?.value?.data?.[0]
        if (!encoded) return
        notifyListeners(parseOraclePrice(Buffer.from(encoded, "base64")))
      }
    } catch {}
  }

  ws.onclose = () => {
    singletonWs = null
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(startSingleton, 1_000)
  }
}

// Boot the singleton as soon as this module is loaded (client-side only)
if (typeof window !== "undefined") {
  startSingleton()
}

export function useOraclePrice(): number | null {
  const [price, setPrice] = useState<number | null>(singletonPrice)

  useEffect(() => {
    // Make sure WS is running (no-op if already open)
    startSingleton()

    const handler = (p: number) => setPrice(p)
    listeners.add(handler)
    return () => { listeners.delete(handler) }
  }, [])

  return price
}
