"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/wallet/ConnectButton";

const tabs = [
  { key: "lobby", label: "LOBBY", href: "/" },
  { key: "create", label: "CREATE", href: "/create" },
];

export function NavBar() {
  const pathname = usePathname();
  const active =
    pathname === "/" ? "lobby" :
    pathname === "/create" ? "create" :
    pathname.startsWith("/game") ? "game" :
    "";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      background: "var(--lavender)",
      borderBottom: "4px solid var(--navy)",
    }}>
      <div style={{ display: "flex" }}>
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <Link key={t.key} href={t.href} style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 10,
              padding: "13px 14px",
              borderRight: "3px solid var(--navy)",
              borderBottom: isActive ? "4px solid var(--yellow)" : "4px solid transparent",
              marginBottom: -4,
              background: isActive ? "var(--navy)" : "transparent",
              color: isActive ? "var(--yellow)" : "var(--navy)",
              cursor: "pointer",
              letterSpacing: "0.5px",
              textDecoration: "none",
              display: "inline-block",
              whiteSpace: "nowrap",
            }}>
              {t.label}
            </Link>
          );
        })}
        {active === "game" && (
          <span style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 10,
            padding: "13px 14px",
            borderRight: "3px solid var(--navy)",
            borderBottom: "4px solid var(--yellow)",
            marginBottom: -4,
            background: "var(--navy)",
            color: "var(--yellow)",
            letterSpacing: "0.5px",
            whiteSpace: "nowrap",
          }}>
            GAME
          </span>
        )}
      </div>
      <div style={{ flex: "1 1 auto" }} />
      <div style={{ padding: "0 14px" }}>
        <ConnectButton />
      </div>
    </div>
  );
}
