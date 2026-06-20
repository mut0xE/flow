"use client";
import { useEffect, useState } from "react";

function makeStars() {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  return Array.from({ length: 70 }, (_, i) => {
    const sz = Math.random() < 0.18 ? 3 : 2;
    return {
      id: i,
      left: rnd(0, 100).toFixed(2) + "%",
      top: rnd(0, 80).toFixed(2) + "%",
      size: sz,
      dur: rnd(1.6, 4.2).toFixed(2),
      delay: rnd(0, 3).toFixed(2),
    };
  });
}

export function StarField() {
  const [stars, setStars] = useState<ReturnType<typeof makeStars>>([]);

  useEffect(() => {
    setStars(makeStars());
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      {stars.map((s) => (
        <span
          key={s.id}
          style={{
            position: "absolute",
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            background: "#fff",
            animation: `twinkle ${s.dur}s steps(2) infinite ${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
