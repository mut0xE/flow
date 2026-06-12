import { PublicKey, TransactionSignature } from "@solana/web3.js";
import BN from "bn.js";

export function logTx(label: string, tx: TransactionSignature) {
  console.log(`\n✅ [${label}]`);
  console.log(`   tx: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
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
