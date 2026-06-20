import { PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";

const L1_EXPLORER = "https://orbmarkets.io/tx";
const ER_EXPLORER_BASE = "https://explorer.solana.com/tx";
const ER_CUSTOM_URL = "https://devnet-as.magicblock.app";

// Pass isEr=true for transactions sent to MagicBlock ER so the link opens the right explorer
export function logTx(label: string, tx: string, isEr = false) {
  const url = isEr
    ? `${ER_EXPLORER_BASE}/${tx}?cluster=custom&customUrl=${ER_CUSTOM_URL}`
    : `${L1_EXPLORER}/${tx}?cluster=devnet`;
  console.log(`\n✅ [${label}]`);
  console.log(`   tx: ${url}`);
}

export function logAccount(label: string, pubkey: PublicKey) {
  console.log(`   ${label}: ${pubkey.toString()}`);
}

export function logField(label: string, value: any) {
  if (value instanceof BN) {
    console.log(`   ${label}: ${value.toString()}`);
  } else {
    console.log(`   ${label}: ${JSON.stringify(value)}`);
  }
}

export function logSection(title: string) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(50)}`);
}

export function logError(label: string, err: any) {
  console.log(`\n❌ [${label}]: ${err?.message || err}`);
}

export function randomGameId(): BN {
  const bytes = Buffer.allocUnsafe(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return new BN(bytes, "le");
}
