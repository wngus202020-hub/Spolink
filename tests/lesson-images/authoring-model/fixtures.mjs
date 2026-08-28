await import("../../profile-api/fixtures.mjs")

export const lessonId = "10000000-0000-4000-8000-000000000001"
export const imageIds = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
]

export const validDraft = {
  address: null,
  cancellationPolicySummary: null,
  capacity: 4,
  description: "충분히 자세한 레슨 설명입니다.",
  durationMinutes: 60,
  placeName: null,
  preparation: null,
  priceAmount: 50000,
  region: "서울 강남구",
  sportId: "40000000-0000-4000-8000-000000000001",
  summary: null,
  title: "테스트 레슨",
}

export function queued(name) {
  return {
    file: new File([name], name, { type: "image/webp" }),
    id: `queued:${name}`,
    kind: "queued",
    status: "queued",
  }
}

export function existing(id, status = "registered") {
  return { id, kind: "existing", previewUrl: `/public/${id}.webp`, status }
}

export function summary(item) {
  return `${item.kind}:${item.status}`
}

export function isUploading(item) {
  return item.kind === "queued" && item.status === "uploading"
}

export function intent(index) {
  return {
    data: {
      expiresAt: "2026-08-26T12:00:00.000Z",
      expiresIn: 7200,
      intentId: `30000000-0000-4000-8000-00000000000${index + 1}`,
      objectName: `${lessonId}/${index}.webp`,
      token: `token-${index}`,
      uploadUrl: `/signed/${index}`,
    },
    status: "success",
  }
}

export function dependencies(overrides) {
  return {
    imageUrl: (objectName) => `/public/${objectName}`,
    reorder: async () => ({ data: { images: [] }, status: "success" }),
    ...overrides,
  }
}
