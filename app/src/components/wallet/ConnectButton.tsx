"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, WalletName } from "@solana/wallet-adapter-base";

function shortAddress(pk: string) {
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export function ConnectButton() {
  const { wallets, select, connect, disconnect, publicKey, connecting } =
    useWallet();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const availableWallets = useMemo(() => {
    return wallets.filter(
      (w) =>
        w.readyState === WalletReadyState.Installed ||
        w.readyState === WalletReadyState.Loadable
    );
  }, [wallets]);

  const handleConnect = async (name: WalletName) => {
    try {
      setOpen(false);
      await select(name);
      await connect();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      {publicKey ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-3 py-1.5 bg-gray-900 border border-gray-700 text-green-400 text-sm font-mono rounded"
        >
          {shortAddress(publicKey.toBase58())}
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={connecting}
          className="px-3 py-1.5 bg-green-900 hover:bg-green-800 border border-green-700 text-green-200 text-sm font-mono rounded"
        >
          {connecting ? "Connecting..." : "Connect Wallet"}
        </button>
      )}

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-950 border border-gray-800 rounded shadow-xl z-50">
          {publicKey ? (
            <button
              onClick={handleDisconnect}
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-900"
            >
              Disconnect
            </button>
          ) : (
            availableWallets.map(({ adapter }) => (
              <button
                key={adapter.name}
                onClick={() => handleConnect(adapter.name)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-200 hover:bg-gray-900"
              >
                {adapter.icon && <img src={adapter.icon} className="w-5 h-5" />}
                {adapter.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
