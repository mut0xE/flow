"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, WalletName } from "@solana/wallet-adapter-base";

function shortAddress(pk: string) {
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function isProblematicWallet(name: string) {
  return name.toLowerCase().includes("metamask");
}

const btnBase: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
  border: "2px solid var(--navy)",
  boxShadow: "3px 3px 0 var(--navy)",
  padding: "7px 10px",
  cursor: "pointer",
  letterSpacing: 0.5,
  whiteSpace: "nowrap",
};

export function ConnectButton() {
  const { wallets, select, connect, disconnect, publicKey, connecting, connected } = useWallet();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const safeWallets = wallets.filter((w) => !isProblematicWallet(w.adapter.name));

  const installedWallets = safeWallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable
  );

  const otherWallets = safeWallets.filter(
    (w) => w.readyState === WalletReadyState.NotDetected
  );

  const handleConnect = useCallback(async (name: WalletName) => {
    setOpen(false);
    try {
      await select(name);
      await connect();
    } catch (e) {
      console.warn("[wallet connect]", e);
    }
  }, [select, connect]);

  const handleDisconnect = async () => {
    await disconnect();
    setOpen(false);
  };

  if (!mounted) {
    return (
      <button style={{ ...btnBase, background: "var(--yellow)", color: "var(--navy)", opacity: 0.5 }} disabled>
        CONNECT WALLET
      </button>
    );
  }

  const walletItemStyle: React.CSSProperties = {
    width: "100%", display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px", fontFamily: "'Press Start 2P', monospace", fontSize: 9,
    background: "transparent", border: "none", borderBottom: "2px solid var(--navy)",
    color: "var(--navy)", cursor: "pointer", textAlign: "left",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {connected && publicKey ? (
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ ...btnBase, background: "var(--navy)", color: "var(--yellow)" }}
        >
          ◎ {shortAddress(publicKey.toBase58())}
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={connecting}
          style={{ ...btnBase, background: "var(--yellow)", color: "var(--navy)" }}
        >
          {connecting ? "CONNECTING…" : "CONNECT WALLET"}
        </button>
      )}

      {open && (
        <div style={{
          position: "absolute", right: 0, marginTop: 6, minWidth: 200,
          background: "var(--lavender)", border: "3px solid var(--navy)",
          boxShadow: "5px 5px 0 var(--navy)", zIndex: 200,
        }}>
          {connected && publicKey ? (
            <button onClick={handleDisconnect} style={{ ...walletItemStyle, color: "var(--red)" }}>
              DISCONNECT
            </button>
          ) : (
            <>
              {installedWallets.length === 0 && otherWallets.length === 0 && (
                <div style={{
                  padding: "12px 14px", fontFamily: "'Press Start 2P', monospace",
                  fontSize: 8, color: "var(--navy)", opacity: 0.7,
                }}>
                  NO WALLET FOUND
                </div>
              )}

              {installedWallets.map(({ adapter }) => (
                <button
                  key={adapter.name}
                  onClick={() => handleConnect(adapter.name)}
                  style={walletItemStyle}
                >
                  {adapter.icon && <img src={adapter.icon} style={{ width: 18, height: 18 }} alt="" />}
                  {adapter.name}
                </button>
              ))}

              {otherWallets.length > 0 && (
                <>
                  {installedWallets.length > 0 && (
                    <div style={{
                      padding: "6px 14px", fontFamily: "'Press Start 2P', monospace",
                      fontSize: 7, color: "var(--navy)", opacity: 0.5,
                      borderTop: "2px solid var(--navy)",
                    }}>
                      NOT INSTALLED
                    </div>
                  )}
                  {otherWallets.map(({ adapter }) => (
                    <button
                      key={adapter.name}
                      onClick={() => handleConnect(adapter.name)}
                      style={{ ...walletItemStyle, opacity: 0.5 }}
                    >
                      {adapter.icon && <img src={adapter.icon} style={{ width: 18, height: 18 }} alt="" />}
                      {adapter.name}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
