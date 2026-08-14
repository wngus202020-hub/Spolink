import { z } from "zod"

const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
})

const supabaseServiceEnvSchema = supabasePublicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

const tossPaymentsEnvSchema = z.object({
  TOSS_PAYMENTS_SECRET_KEY: z.string().min(1),
})

const edgeRuntimeEnvSchema = z.object({
  SPOLINK_EDGE_SECRET: z.string().min(16),
})

type SupabasePublicEnvSource = Readonly<{
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string | undefined
  NEXT_PUBLIC_SUPABASE_URL: string | undefined
}>

type SupabaseServiceEnvSource = SupabasePublicEnvSource &
  Readonly<{
    SUPABASE_SERVICE_ROLE_KEY: string | undefined
  }>

type TossPaymentsEnvSource = Readonly<{
  TOSS_PAYMENTS_SECRET_KEY: string | undefined
}>

type EdgeRuntimeEnvSource = Readonly<{
  SPOLINK_EDGE_SECRET: string | undefined
}>

export type SupabasePublicEnv = Readonly<{
  supabaseAnonKey: string
  supabaseUrl: string
}>

export type SupabaseServiceEnv = Readonly<{
  serviceRoleKey: string
  supabaseUrl: string
}>

export type TossPaymentsEnv = Readonly<{
  secretKey: string
}>

export type EdgeRuntimeEnv = Readonly<{
  edgeSecret: string
}>

export type SupabaseConfigStatus = Readonly<
  | {
      configured: true
      invalidKeys: readonly []
      missingKeys: readonly []
    }
  | {
      configured: false
      invalidKeys: readonly string[]
      missingKeys: readonly string[]
    }
>

export type TossPaymentsConfigStatus = Readonly<
  | {
      configured: true
      invalidKeys: readonly []
      missingKeys: readonly []
    }
  | {
      configured: false
      invalidKeys: readonly string[]
      missingKeys: readonly string[]
    }
>

export type EdgeRuntimeConfigStatus = SupabaseConfigStatus

export class SupabaseConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Supabase public environment is not configured: ${issues.join(", ")}`)
    this.name = "SupabaseConfigError"
    this.issues = issues
  }
}

export function getSupabasePublicEnvSource(): SupabasePublicEnvSource {
  return {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }
}

export function getSupabaseServiceEnvSource(): SupabaseServiceEnvSource {
  return {
    ...getSupabasePublicEnvSource(),
    SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"],
  }
}

export function getTossPaymentsEnvSource(): TossPaymentsEnvSource {
  return {
    TOSS_PAYMENTS_SECRET_KEY: process.env["TOSS_PAYMENTS_SECRET_KEY"],
  }
}

export function getEdgeRuntimeEnvSource(): EdgeRuntimeEnvSource {
  return {
    SPOLINK_EDGE_SECRET: process.env["SPOLINK_EDGE_SECRET"],
  }
}

export function readSupabasePublicEnv(
  source: SupabasePublicEnvSource = getSupabasePublicEnvSource(),
): SupabasePublicEnv {
  const parsedEnv = supabasePublicEnvSchema.safeParse(source)

  if (!parsedEnv.success) {
    throw new SupabaseConfigError(formatIssues(parsedEnv.error.issues))
  }

  return {
    supabaseAnonKey: parsedEnv.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseUrl: parsedEnv.data.NEXT_PUBLIC_SUPABASE_URL,
  }
}

export function getSupabaseConfigStatus(
  source: SupabasePublicEnvSource = getSupabasePublicEnvSource(),
): SupabaseConfigStatus {
  const parsedEnv = supabasePublicEnvSchema.safeParse(source)

  if (parsedEnv.success) {
    return {
      configured: true,
      invalidKeys: [],
      missingKeys: [],
    }
  }

  const missingKeys = parsedEnv.error.issues
    .filter((issue) => issue.code === "invalid_type")
    .map((issue) => issue.path.join("."))

  const invalidKeys = parsedEnv.error.issues
    .filter((issue) => issue.code !== "invalid_type")
    .map((issue) => issue.path.join("."))

  return {
    configured: false,
    invalidKeys,
    missingKeys,
  }
}

export function readSupabaseServiceEnv(
  source: SupabaseServiceEnvSource = getSupabaseServiceEnvSource(),
): SupabaseServiceEnv {
  const parsedEnv = supabaseServiceEnvSchema.safeParse(source)

  if (!parsedEnv.success) {
    throw new SupabaseConfigError(formatIssues(parsedEnv.error.issues))
  }

  return {
    serviceRoleKey: parsedEnv.data.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: parsedEnv.data.NEXT_PUBLIC_SUPABASE_URL,
  }
}

export function getSupabaseServiceConfigStatus(
  source: SupabaseServiceEnvSource = getSupabaseServiceEnvSource(),
): SupabaseConfigStatus {
  return readConfigStatus(supabaseServiceEnvSchema, source)
}

export function readTossPaymentsEnv(
  source: TossPaymentsEnvSource = getTossPaymentsEnvSource(),
): TossPaymentsEnv {
  const parsedEnv = tossPaymentsEnvSchema.safeParse(source)

  if (!parsedEnv.success) {
    throw new SupabaseConfigError(formatIssues(parsedEnv.error.issues))
  }

  return {
    secretKey: parsedEnv.data.TOSS_PAYMENTS_SECRET_KEY,
  }
}

export function getTossPaymentsConfigStatus(
  source: TossPaymentsEnvSource = getTossPaymentsEnvSource(),
): TossPaymentsConfigStatus {
  return readConfigStatus(tossPaymentsEnvSchema, source)
}

export function readEdgeRuntimeEnv(
  source: EdgeRuntimeEnvSource = getEdgeRuntimeEnvSource(),
): EdgeRuntimeEnv {
  const parsedEnv = edgeRuntimeEnvSchema.safeParse(source)

  if (!parsedEnv.success) {
    throw new SupabaseConfigError(formatIssues(parsedEnv.error.issues))
  }

  return {
    edgeSecret: parsedEnv.data.SPOLINK_EDGE_SECRET,
  }
}

export function getEdgeRuntimeConfigStatus(
  source: EdgeRuntimeEnvSource = getEdgeRuntimeEnvSource(),
): EdgeRuntimeConfigStatus {
  return readConfigStatus(edgeRuntimeEnvSchema, source)
}

function readConfigStatus<EnvSource>(
  schema: z.ZodType<unknown, EnvSource>,
  source: EnvSource,
): SupabaseConfigStatus {
  const parsedEnv = schema.safeParse(source)

  if (parsedEnv.success) {
    return {
      configured: true,
      invalidKeys: [],
      missingKeys: [],
    }
  }

  const missingKeys = parsedEnv.error.issues
    .filter((issue) => issue.code === "invalid_type")
    .map((issue) => issue.path.join("."))

  const invalidKeys = parsedEnv.error.issues
    .filter((issue) => issue.code !== "invalid_type")
    .map((issue) => issue.path.join("."))

  return {
    configured: false,
    invalidKeys,
    missingKeys,
  }
}

function formatIssues(issues: readonly z.core.$ZodIssue[]) {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
}
