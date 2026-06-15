import { Program, AnchorProvider } from "@coral-xyz/anchor"
import { PublicKey } from "@solana/web3.js"
import IDL from "@/idl/flow.json"

export const PROGRAM_ID = new PublicKey("DqudaX63SvHn6LLe4SERwxNoiLvyLNfjYjgAVcjH9szp")

export function getProgram(provider: AnchorProvider): Program {
  return new Program(IDL as any, provider)
}
