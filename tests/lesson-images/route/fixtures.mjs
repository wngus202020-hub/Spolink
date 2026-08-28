await import("../../profile-api/fixtures.mjs")

export const {
  createDeleteLessonImageRouteHandler,
  createIssueLessonImageUploadIntentRouteHandler,
  createRegisterLessonImageRouteHandler,
  createReorderLessonImagesRouteHandler,
} = await import("../../../lib/lessons/lesson-image-route-handlers.ts")

export const origin = "http://127.0.0.1:3214"
export const lessonId = "10000000-0000-4000-8000-000000000001"
export const imageId = "20000000-0000-4000-8000-000000000001"
export const secondImageId = "20000000-0000-4000-8000-000000000002"
export const intentId = "30000000-0000-4000-8000-000000000001"
export const objectName = `${lessonId}/40000000-0000-4000-8000-000000000001.webp`
export const readyImages = [
  { id: imageId, objectName, sortOrder: 0 },
  {
    id: secondImageId,
    objectName: `${lessonId}/40000000-0000-4000-8000-000000000002.png`,
    sortOrder: 1,
  },
]

export function routeDependencies(overrides = {}, routeOverrides = {}) {
  return {
    createWorkflowDependencies: async () => workflowDependencies(overrides),
    isSupabaseConfigured: () => true,
    ...routeOverrides,
  }
}

export function workflowDependencies(overrides = {}) {
  return {
    actor: "authenticated",
    authenticate: async () => overrides.actor ?? "authenticated",
    deleteImage: async () => readyImages,
    issueUploadIntent: async () => ({
      expiresAt: "2026-08-25T12:00:00.000Z",
      expiresIn: 7200,
      intentId,
      objectName,
      token: "token",
      uploadUrl: "/signed",
    }),
    registerImage: async () => readyImages,
    reorderImages: async () => readyImages,
    runCleanup: async () => {},
    ...overrides,
  }
}

export function lessonContext() {
  return { params: Promise.resolve({ lessonId }) }
}

export function imageContext() {
  return { params: Promise.resolve({ imageId, lessonId }) }
}

export function jsonRequest(path, body, method = "POST", options = {}) {
  return new Request(`${origin}/api/lessons/${lessonId}/${path}`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "Content-Type": options.contentType ?? "application/json",
      Origin: options.origin ?? origin,
    },
    method,
  })
}

export function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
