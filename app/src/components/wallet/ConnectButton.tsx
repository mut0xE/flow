"use client"
import { useState, useEffect, useRef } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base"

function shortAddress(pk: string) {
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

export function ConnectButton() {
  const { select, connect, disconnect, publicKey, wallet, wallets, connecting } = useWallet()
  const [open, setOpen] = useState(false)
  const [pendingName, setPendingName] = useState<WalletName | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const availableWallets = wallets.filter(
    ({ readyState }) =>
      readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable
  )

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Once wallet adapter matches what we selected, call connect()
  useEffect(() => {
    if (!pendingName) return
    if (wallet?.adapter.name !== pendingName) return
    if (publicKey || connecting) return
    setPendingName(null)
    connect().catch((e) => console.error("wallet connect failed:", e))
  }, [pendingName, wallet, publicKey, connecting, connect])

  function handleSelect(name: WalletName) {
    setPendingName(name)
    select(name)
    setOpen(false)
  }

  if (publicKey) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="px-3 py-1.5 bg-gray-900 border border-gray-700 hover:border-gray-500 text-green-400 text-sm font-mono rounded transition-colors"
        >
          {shortAddress(publicKey.toBase58())}
        </button>
        {open && (
          <div className="absolute right-0 mt-1 bg-gray-950 border border-gray-800 rounded shadow-xl z-50 min-w-[140px]">
            <button
              onClick={() => { disconnect(); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-900 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={connecting}
        className="px-3 py-1.5 bg-green-900 hover:bg-green-800 border border-green-700 text-green-300 text-sm font-mono rounded transition-colors disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-gray-950 border border-gray-800 rounded shadow-xl z-50 min-w-[200px]">
          {availableWallets.length === 0 ? (
            <div className="px-4 py-3 text-xs text-gray-500">
              No wallets found.<br />Install Phantom or Solflare.
            </div>
          ) : (
            availableWallets.map(({ adapter }) => (
              <button
                key={adapter.name}
                onClick={() => handleSelect(adapter.name)}
                className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-900 transition-colors"
              >
                {adapter.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={adapter.icon} alt="" className="w-5 h-5 rounded" />
                )}
                {adapter.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
