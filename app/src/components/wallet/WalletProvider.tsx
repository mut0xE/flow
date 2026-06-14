"use client";
import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { L1_RPC } from "@/lib/connections";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Solflare legacy adapter as fallback — Standard Wallet auto-discovery handles Phantom.
  // If Solflare is already detected via Standard Wallet, wallet-adapter-react deduplicates.
  const wallets = useMemo(() => [new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={L1_RPC}>
      <SolanaWalletProvider wallets={wallets} autoConnect>{children}</SolanaWalletProvider>
    </ConnectionProvider>
  );
}
