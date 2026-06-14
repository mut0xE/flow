"use client"
import { useEffect, useState, useRef } from "react"
import { ORACLE_SOL_USD, parseOraclePrice } from "@/lib/oracle"

export function useOraclePrice(): number | null {
  const [price, setPrice] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    function connect() {
      const ws = new WebSocket("wss://devnet.magicblock.app")
      wsRef.current = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "accountSubscribe",
          params: [ORACLE_SOL_USD.toBase58(), { encoding: "base64", commitment: "confirmed" }]
        }))
      }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.method === "accountNotification") {
            const encoded = msg.params?.result?.value?.data?.[0]
            if (!encoded) return
            setPrice(parseOraclePrice(Buffer.from(encoded, "base64")))
          }
        } catch {}
      }
      ws.onclose = () => setTimeout(connect, 1_000)
    }
    connect()
    return () => { wsRef.current?.close() }
  }, [])

  return price
}
