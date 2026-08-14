export const PROJECT_ID = "spolink"
export const PROJECT_LABEL = "com.supabase.cli.project=spolink"
export const PROJECT_RESOURCE_PATTERN = /^supabase_[a-z0-9_-]+_spolink$/
export const PROJECT_RESOURCE_PATTERN_TEXT = "^supabase_[a-z0-9_-]+_spolink$"
export const SUPABASE_PORTS = [54320, 54321, 54322, 54323, 54324, 54327]
export const RUNTIME_RECEIPT_PATH = ".omo/evidence/runtime-receipt-supabase-auth-rls-e2e.json"
export const ZERO_RESOURCES_PATH = ".omo/evidence/runtime-zero-resources-supabase-auth-rls-e2e.json"
export const INSTALL_AUTHORIZATION_PATH =
  ".omo/evidence/docker-install-authorization-supabase-auth-rls-e2e.json"
export const DIRECT_TRIGGER = "$omo:start-work .omo/plans/supabase-auth-rls-e2e.md"
export const RUNTIME_LOCK_FILENAME = "runtime-lock-supabase-auth-rls-e2e.lock"
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1_000
export const RUNTIME_DIRS = [".supabase", "supabase/.temp", "supabase/.branches"]

export const statusArgs = [
  "status",
  "-o",
  "json",
  "--override-name",
  "api.url=API_URL",
  "--override-name",
  "db.url=DB_URL",
  "--override-name",
  "auth.publishable_key=PUBLISHABLE_KEY",
  "--override-name",
  "auth.secret_key=SECRET_KEY",
  "--override-name",
  "auth.anon_key=ANON_KEY",
  "--override-name",
  "auth.service_role_key=SERVICE_ROLE_KEY",
]

export const stopArgs = ["stop", "--no-backup", "--project-id", PROJECT_ID]
export const testDbArgs = ["test", "db", "supabase/tests", "--local"]
