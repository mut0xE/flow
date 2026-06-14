import { Program, AnchorProvider } from "@coral-xyz/anchor"
import { PublicKey } from "@solana/web3.js"
import IDL from "@/idl/flow.json"

export const PROGRAM_ID = new PublicKey("4ZAPNxawvTPH41hJ2VhWGwGttPWNXmbqnXFwehTCjyPs")

export function getProgram(provider: AnchorProvider): Program {
  return new Program(IDL as any, provider)
}
