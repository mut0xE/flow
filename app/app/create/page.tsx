import Link from "next/link"
import { CreateGameForm } from "@/components/game/CreateGameForm"

export default function CreateGamePage() {
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors inline-flex items-center gap-1 mb-4">
          ← Back
        </Link>
        <h1 className="text-xl font-bold text-white">Create Game</h1>
        <p className="text-gray-400 text-sm mt-1">Set the rules, then invite players to join.</p>
      </div>
      <CreateGameForm />
    </div>
  )
}
