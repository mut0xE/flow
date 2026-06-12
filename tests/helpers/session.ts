import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { Keypair } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "fs";

export const SESSION_TOKEN_SEED = "session_token_v2";

export function initializeSessionSignerKeypair(): Keypair {
  let signer: Keypair;

  if (!process.env.SESSION_SIGNER_PRIVATE_KEY) {
    signer = Keypair.generate();
    // Append the new key-value pair to the contents of the .env file
    writeFileSync(
      ".env",
      `SESSION_SIGNER_PRIVATE_KEY=[${signer.secretKey.toString()}]\n`
    );
  } else {
    const secret = JSON.parse(
      process.env.SESSION_SIGNER_PRIVATE_KEY ?? ""
    ) as number[];
    const secretKey = Uint8Array.from(secret);
    signer = Keypair.fromSecretKey(secretKey);
  }

  return signer;
}

export function getCreatorSessionKeypair(): Keypair {
  if (!process.env.CREATOR_SESSION_KEY) {
    const keypair = Keypair.generate();
    writeFileSync(
      ".env",
      `\nCREATOR_SESSION_KEY=[${keypair.secretKey.toString()}]\n`,
      { flag: "a" }
    );
    return keypair;
  }
  const secret = JSON.parse(process.env.CREATOR_SESSION_KEY) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function getPlayer2SessionKeypair(): Keypair {
  if (!process.env.PLAYER2_SESSION_KEY) {
    const keypair = Keypair.generate();
    writeFileSync(
      ".env",
      `\nPLAYER2_SESSION_KEY=[${keypair.secretKey.toString()}]\n`,
      { flag: "a" }
    );
    return keypair;
  }
  const secret = JSON.parse(process.env.PLAYER2_SESSION_KEY) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
