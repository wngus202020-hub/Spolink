"use client"

const scriptId = "spolink-naver-maps"
let loadingPromise: Promise<void> | null = null

export function loadNaverMaps(clientId: string): Promise<void> {
  if (typeof naver !== "undefined" && naver.maps) return Promise.resolve()
  if (loadingPromise) return loadingPromise

  const nextPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(scriptId)
    if (existing instanceof HTMLScriptElement) {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new NaverMapsLoadError()), { once: true })
      return
    }

    const script = document.createElement("script")
    script.id = scriptId
    script.async = true
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`
    script.addEventListener("load", () => resolve(), { once: true })
    script.addEventListener(
      "error",
      () => {
        script.remove()
        reject(new NaverMapsLoadError())
      },
      { once: true },
    )
    document.head.append(script)
  }).catch((error: unknown) => {
    loadingPromise = null
    throw error
  })

  loadingPromise = nextPromise
  return nextPromise
}

class NaverMapsLoadError extends Error {
  readonly name = "NaverMapsLoadError"

  constructor() {
    super("NAVER Maps script failed to load.")
  }
}
