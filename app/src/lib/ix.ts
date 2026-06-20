import { AccountRole, type Instruction } from "@solana/kit"
import { PublicKey, TransactionInstruction, AccountMeta } from "@solana/web3.js"

export function toWeb3Ix(ix: Instruction): TransactionInstruction {
  const keys: AccountMeta[] = (ix.accounts ?? []).map((a) => ({
    pubkey: new PublicKey(a.address as string),
    isSigner: a.role === AccountRole.WRITABLE_SIGNER || a.role === AccountRole.READONLY_SIGNER,
    isWritable: a.role === AccountRole.WRITABLE_SIGNER || a.role === AccountRole.WRITABLE,
  }))
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress as string),
    keys,
    data: ix.data ? Buffer.from(ix.data) : Buffer.alloc(0),
  })
}
