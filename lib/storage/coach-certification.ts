import { z } from "zod"

export const COACH_CERTIFICATE_BUCKET = "coach-certificates"
export const COACH_CERTIFICATE_MAX_BYTES = 10 * 1024 * 1024
export const COACH_CERTIFICATE_SIGNED_URL_SECONDS = 300

const mimeTypes = ["image/png", "image/jpeg", "application/pdf"] as const
type CertificateMimeType = (typeof mimeTypes)[number]
type CertificateExtension = "png" | "jpg" | "pdf"

const uploadRequestSchema = z.object({
  mimeType: z.enum(mimeTypes),
  sizeBytes: z.number().int().positive().max(COACH_CERTIFICATE_MAX_BYTES),
  userId: z.uuid(),
})
const objectNameSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|pdf)$/u,
  )

const extensionByMime = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const satisfies Record<CertificateMimeType, CertificateExtension>

export type ApplicantStorageState = Readonly<{
  coachStatus: "draft" | "submitted" | "approved" | "rejected" | "suspended"
  role: "admin" | "coach" | "learner"
  status: "active" | "pending_coach" | "coach_approved" | "suspended" | "deleted"
}>

export type SignedUploadResult = Readonly<{
  expiresIn: 300
  objectName: string
  token: string
  uploadUrl: string
}>

export type ValidatedCertificate = Readonly<{
  extension: CertificateExtension
  mimeType: CertificateMimeType
  sizeBytes: number
}>

type StorageErrorCode =
  | "forbidden"
  | "invalid_file"
  | "invalid_object_name"
  | "metadata_registration_failed"
  | "not_found"
  | "storage_failure"

export class CoachCertificateStorageError extends Error {
  readonly code: StorageErrorCode

  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CoachCertificateStorageError"
    this.code = code
  }
}

export async function createCoachCertificateSignedUpload(
  input: unknown,
  dependencies: Readonly<{
    createObjectId: () => string
    createSignedUploadUrl: (
      bucket: string,
      objectName: string,
    ) => Promise<Readonly<{ signedUrl: string; token: string }>>
    readApplicantState: (userId: string) => Promise<ApplicantStorageState | null>
  }>,
): Promise<SignedUploadResult> {
  const parsed = uploadRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new CoachCertificateStorageError("invalid_file", "Certificate upload input is invalid.")
  }
  const applicant = await dependencies.readApplicantState(parsed.data.userId)
  if (
    applicant?.role !== "learner" ||
    applicant.status !== "active" ||
    !["draft", "rejected"].includes(applicant.coachStatus)
  ) {
    throw new CoachCertificateStorageError("forbidden", "Applicant cannot upload certificates.")
  }

  const objectId = z.uuid().parse(dependencies.createObjectId())
  const objectName = `${parsed.data.userId}/${objectId}.${extensionByMime[parsed.data.mimeType]}`
  const signed = await dependencies.createSignedUploadUrl(COACH_CERTIFICATE_BUCKET, objectName)
  return {
    expiresIn: COACH_CERTIFICATE_SIGNED_URL_SECONDS,
    objectName,
    token: signed.token,
    uploadUrl: signed.signedUrl,
  }
}

export async function validateCoachCertificateBlob(
  blob: Blob,
  objectName: unknown,
): Promise<ValidatedCertificate> {
  const parsedObjectName = parseObjectName(objectName)
  if (blob.size === 0 || blob.size > COACH_CERTIFICATE_MAX_BYTES || !isCertificateMime(blob.type)) {
    throw new CoachCertificateStorageError("invalid_file", "Certificate file is invalid.")
  }
  const extension = parsedObjectName.slice(parsedObjectName.lastIndexOf(".") + 1)
  const expectedExtension = extensionByMime[blob.type]
  if (extension !== expectedExtension) {
    throw new CoachCertificateStorageError(
      "invalid_file",
      "Certificate type does not match its object name.",
    )
  }

  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  if (!hasMagicBytes(blob.type, signature)) {
    throw new CoachCertificateStorageError("invalid_file", "Certificate signature is invalid.")
  }
  return { extension: expectedExtension, mimeType: blob.type, sizeBytes: blob.size }
}

export async function registerCertificateMetadataWithCompensation(
  input: Readonly<{ objectName: unknown; userId: string }>,
  dependencies: Readonly<{
    readObject: (bucket: string, objectName: string) => Promise<Blob | null>
    registerMetadata: (validated: ValidatedCertificate, objectName: string) => Promise<void>
    removeObject: (bucket: string, objectName: string) => Promise<void>
  }>,
): Promise<ValidatedCertificate> {
  const objectName = parseOwnedObjectName(input.objectName, input.userId)
  try {
    const blob = await dependencies.readObject(COACH_CERTIFICATE_BUCKET, objectName)
    if (!blob)
      throw new CoachCertificateStorageError("not_found", "Certificate object was not found.")
    const validated = await validateCoachCertificateBlob(blob, objectName)
    await dependencies.registerMetadata(validated, objectName)
    return validated
  } catch (error) {
    await dependencies.removeObject(COACH_CERTIFICATE_BUCKET, objectName)
    if (error instanceof CoachCertificateStorageError) throw error
    throw new CoachCertificateStorageError(
      "metadata_registration_failed",
      "Certificate metadata registration failed.",
      { cause: error },
    )
  }
}

export async function createAdminCertificateSignedRead(
  input: Readonly<{ adminUserId: string; objectName: unknown }>,
  dependencies: Readonly<{
    createSignedReadUrl: (bucket: string, objectName: string, expiresIn: number) => Promise<string>
    isActiveAdmin: (userId: string) => Promise<boolean>
    isRegisteredObject: (objectName: string) => Promise<boolean>
  }>,
): Promise<Readonly<{ expiresIn: 300; readUrl: string }>> {
  const adminUserId = z.uuid().safeParse(input.adminUserId)
  if (!adminUserId.success || !(await dependencies.isActiveAdmin(adminUserId.data))) {
    throw new CoachCertificateStorageError("forbidden", "Administrator access is required.")
  }
  const objectName = parseObjectName(input.objectName)
  if (!(await dependencies.isRegisteredObject(objectName))) {
    throw new CoachCertificateStorageError("not_found", "Certificate metadata was not found.")
  }
  const readUrl = await dependencies.createSignedReadUrl(
    COACH_CERTIFICATE_BUCKET,
    objectName,
    COACH_CERTIFICATE_SIGNED_URL_SECONDS,
  )
  return { expiresIn: COACH_CERTIFICATE_SIGNED_URL_SECONDS, readUrl }
}

function parseOwnedObjectName(value: unknown, userId: string): string {
  const parsed = parseObjectName(value)
  if (!z.uuid().safeParse(userId).success || !parsed.startsWith(`${userId}/`)) {
    throw new CoachCertificateStorageError("forbidden", "Certificate object owner is invalid.")
  }
  return parsed
}

function parseObjectName(value: unknown): string {
  const parsed = objectNameSchema.safeParse(value)
  if (!parsed.success) {
    throw new CoachCertificateStorageError(
      "invalid_object_name",
      "Certificate object name is invalid.",
    )
  }
  return parsed.data
}

function isCertificateMime(value: string): value is CertificateMimeType {
  return mimeTypes.some((mimeType) => mimeType === value)
}

function hasMagicBytes(mimeType: CertificateMimeType, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case "application/pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value)
}
