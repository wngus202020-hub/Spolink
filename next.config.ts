import type { NextConfig } from "next"

type ImageRemotePattern = Readonly<{
  hostname: string
  pathname: string
  protocol: "http" | "https"
}>

const AUTH_PAGE_CACHE_CONTROL = "private, no-store"
const supabasePublicEnvConfigured = hasSupabasePublicEnv()

function getSupabaseImageRemotePatterns(): ImageRemotePattern[] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    return []
  }

  const { hostname, protocol } = new URL(supabaseUrl)
  const imageProtocol = protocol === "http:" ? "http" : "https"

  return [
    {
      hostname,
      pathname: "/storage/v1/object/public/lesson-images/**",
      protocol: imageProtocol,
    },
  ]
}

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    if (!supabasePublicEnvConfigured) return []

    return [
      {
        headers: [{ key: "Cache-Control", value: AUTH_PAGE_CACHE_CONTROL }],
        source: "/lessons",
      },
      {
        headers: [{ key: "Cache-Control", value: AUTH_PAGE_CACHE_CONTROL }],
        source: "/lessons/:path*",
      },
      {
        headers: [{ key: "Cache-Control", value: AUTH_PAGE_CACHE_CONTROL }],
        source: "/coach/apply/status",
      },
    ]
  },
  images: {
    remotePatterns: getSupabaseImageRemotePatterns(),
  },
  poweredByHeader: false,
  reactStrictMode: true,
}

export default nextConfig

function hasSupabasePublicEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
