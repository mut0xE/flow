import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletContextProvider } from "@/components/wallet/WalletProvider";
import { ConnectButton } from "@/components/wallet/ConnectButton";

const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "FLOW — Hot Potato Trading Game",
  description:
    "Pass the live SOL position before it reverses. Earn yield from real price movement.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${mono.variable} font-mono bg-black text-white min-h-screen`}
      >
        <WalletContextProvider>
          <header className="border-b border-gray-900 px-6 py-3 flex items-center justify-between">
            <a
              href="/"
              className="text-green-400 font-bold text-lg tracking-widest"
            >
              FLOW
            </a>
            <ConnectButton />
          </header>
          <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
        </WalletContextProvider>
      </body>
    </html>
  );
}
