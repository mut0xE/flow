import type { NextConfig } from "next"
const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      buffer: "buffer/",
    },
  },
}
export default nextConfig
