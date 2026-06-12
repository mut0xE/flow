import * as anchor from "@coral-xyz/anchor";
import {
  ConnectionMagicRouter,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { randomBytes } from "crypto";

export const L1_ENDPOINT =
  process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
export const ER_RPC = "https://devnet-as.magicblock.app/";
export const ER_WS = "wss://devnet-router.magicblock.app";
export const ROUTER_ENDPOINT = "https://devnet-router.magicblock.app";
export const ROUTER_WS_ENDPOINT = "wss://devnet-router.magicblock.app";

export const ER_VALIDATOR = getErValidator(ER_RPC);

export const SOL_USD_FEED = new anchor.web3.PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"
);

// ── Magic Router ──────────────────────────────────────
export function getMagicRouter(): ConnectionMagicRouter {
  return new ConnectionMagicRouter(ROUTER_ENDPOINT, {
    wsEndpoint: ROUTER_WS_ENDPOINT,
  });
}

export function getErProvider(wallet: anchor.Wallet): anchor.AnchorProvider {
  return new anchor.AnchorProvider(
    new anchor.web3.Connection(ER_RPC, {
      wsEndpoint: ER_WS,
      commitment: "confirmed",
    }),
    wallet,
    { commitment: "confirmed" }
  );
}

export async function airdropFromWallet(
  provider: anchor.Provider,
  from: Keypair,
  to: PublicKey,
  solAmount: number = 0.5
): Promise<void> {
  const tx = new Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: solAmount * LAMPORTS_PER_SOL,
    })
  );
  const sig = await provider.sendAndConfirm(tx, [from]);
  console.log(`   funded`, sig);
}

type JsonRpcResponse = {
  jsonrpc: string;
  id: number;
  result?: {
    identity: string;
  };
  error?: any;
};

export async function getErValidator(baseUrl: string): Promise<PublicKey> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getIdentity",
      params: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const data = (await response.json()) as JsonRpcResponse;

  if (data.error) {
    throw new Error(`getIdentity failed: ${JSON.stringify(data.error)}`);
  }

  const identity = data.result?.identity;

  if (!identity) {
    throw new Error(
      `getIdentity returned no identity: ${JSON.stringify(data.result)}`
    );
  }

  return new PublicKey(identity);
}

// ── Wait for ER commit to land on L1 ─────────────────
export async function waitForCommitment(
  erTxHash: string,
  router: ConnectionMagicRouter
): Promise<string> {
  return GetCommitmentSignature(erTxHash, router);
}

export async function sleep(seconds: number): Promise<void> {
  const interval = 500;
  const iters = Math.floor((seconds * 1000) / interval);

  for (let i = 0; i < iters; i++) {
    const dots = ".".repeat((i % 3) + 1);
    process.stdout.write(`\rWaiting${dots}   `);
    await new Promise((r) => setTimeout(r, interval));
  }
  process.stdout.write("\r\x1b[K");
}
