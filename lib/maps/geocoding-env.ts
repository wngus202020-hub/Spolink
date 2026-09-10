import "server-only"

import { z } from "zod"

const naverGeocodingEnvSchema = z.strictObject({
  NAVER_MAPS_CLIENT_ID: z.string().trim().min(1),
  NAVER_MAPS_CLIENT_SECRET: z.string().trim().min(1),
})
const naverMapsClientIdSchema = z.string().trim().min(1)

type NaverGeocodingEnvSource = Readonly<{
  NAVER_MAPS_CLIENT_ID: string | undefined
  NAVER_MAPS_CLIENT_SECRET: string | undefined
}>

export type NaverGeocodingEnv = Readonly<{
  clientId: string
  clientSecret: string
}>

function getNaverGeocodingEnvSource(): NaverGeocodingEnvSource {
  return {
    NAVER_MAPS_CLIENT_ID: process.env["NAVER_MAPS_CLIENT_ID"],
    NAVER_MAPS_CLIENT_SECRET: process.env["NAVER_MAPS_CLIENT_SECRET"],
  }
}

export function isNaverGeocodingConfigured(
  source: NaverGeocodingEnvSource = getNaverGeocodingEnvSource(),
) {
  return naverGeocodingEnvSchema.safeParse(source).success
}

export function readNaverMapsClientId(
  source: NaverGeocodingEnvSource = getNaverGeocodingEnvSource(),
) {
  const parsed = naverMapsClientIdSchema.safeParse(source.NAVER_MAPS_CLIENT_ID)
  return parsed.success ? parsed.data : null
}

export function readNaverGeocodingEnv(
  source: NaverGeocodingEnvSource = getNaverGeocodingEnvSource(),
): NaverGeocodingEnv {
  const parsed = naverGeocodingEnvSchema.safeParse(source)
  if (!parsed.success) throw new NaverGeocodingConfigError()
  return {
    clientId: parsed.data.NAVER_MAPS_CLIENT_ID,
    clientSecret: parsed.data.NAVER_MAPS_CLIENT_SECRET,
  }
}

export class NaverGeocodingConfigError extends Error {
  readonly name = "NaverGeocodingConfigError"

  constructor() {
    super("NAVER Maps geocoding is not configured.")
  }
}
