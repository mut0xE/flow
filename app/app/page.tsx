import Link from "next/link"
import { GameLobby } from "@/components/game/GameLobby"

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-green-400 tracking-widest">FLOW</h1>
        <p className="text-gray-400 text-sm">Pass the live SOL position before it reverses. Earn yield from real price movement.</p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm text-gray-500 uppercase tracking-wider">Games</h2>
        <Link href="/create"
          className="px-4 py-2 bg-green-800 hover:bg-green-700 text-white text-sm rounded transition-colors font-bold">
          + Create Game
        </Link>
      </div>

      <GameLobby />
    </div>
  )
}
