"use client"

import { MapPin } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"

import type { Lesson } from "@/lib/home-data"
import { selectMappableLessons } from "@/lib/maps/lesson-map-model"
import { loadNaverMaps } from "@/lib/maps/naver-maps-browser"

export function LessonMap({
  clientId,
  lessons,
}: Readonly<{
  clientId: string | null
  lessons: readonly Lesson[]
}>) {
  const mappableLessons = useMemo(() => selectMappableLessons(lessons), [lessons])
  const [selectedId, setSelectedId] = useState(mappableLessons[0]?.id ?? null)
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle")
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<naver.maps.Map | null>(null)
  const markersRef = useRef<ReadonlyMap<string, naver.maps.Marker>>(new Map())

  useEffect(() => {
    if (!clientId || mappableLessons.length === 0 || !containerRef.current) return
    let cancelled = false
    const markers: naver.maps.Marker[] = []
    setState("loading")

    void loadNaverMaps(clientId)
      .then(() => {
        const container = containerRef.current
        const first = mappableLessons[0]
        if (cancelled || !container || !first) return
        const firstPosition = new naver.maps.LatLng(
          first.location.latitude,
          first.location.longitude,
        )
        const map = new naver.maps.Map(container, { center: firstPosition, zoom: 14 })
        const bounds = new naver.maps.LatLngBounds(firstPosition, firstPosition)
        const markerEntries = mappableLessons.map((lesson) => {
          const position = new naver.maps.LatLng(
            lesson.location.latitude,
            lesson.location.longitude,
          )
          bounds.extend(position)
          const marker = new naver.maps.Marker({
            clickable: true,
            map,
            position,
            title: lesson.title,
          })
          naver.maps.Event.addListener(marker, "click", () => setSelectedId(lesson.id))
          markers.push(marker)
          return [lesson.id, marker] as const
        })
        if (mappableLessons.length > 1) map.fitBounds(bounds)
        mapRef.current = map
        markersRef.current = new Map(markerEntries)
        setState("ready")
      })
      .catch((error: unknown) => {
        if (error instanceof Error && !cancelled) setState("unavailable")
      })

    return () => {
      cancelled = true
      for (const marker of markers) {
        naver.maps.Event.clearInstanceListeners(marker)
        marker.setMap(null)
      }
      mapRef.current?.destroy()
      mapRef.current = null
      markersRef.current = new Map()
    }
  }, [clientId, mappableLessons])

  useEffect(() => {
    for (const [lessonId, marker] of markersRef.current) {
      marker.setZIndex(lessonId === selectedId ? 100 : 1)
    }
  }, [selectedId])

  function selectLesson(lesson: (typeof mappableLessons)[number]) {
    setSelectedId(lesson.id)
    if (mapRef.current && typeof naver !== "undefined") {
      mapRef.current.panTo(
        new naver.maps.LatLng(lesson.location.latitude, lesson.location.longitude),
      )
    }
  }

  if (!clientId) return <MapUnavailable message="지도를 불러올 수 없습니다." />
  if (mappableLessons.length === 0) {
    return <MapUnavailable message="지도에 표시할 위치가 등록된 레슨이 없습니다." />
  }

  return (
    <div className="grid min-w-0 overflow-hidden border border-line bg-canvas lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative min-h-[440px] lg:min-h-[620px]">
        <div className="absolute inset-0" ref={containerRef} />
        {state !== "ready" ? (
          <div className="absolute inset-0 grid place-items-center bg-inset px-6 text-center">
            <p aria-live="polite" className="m-0 text-sm font-bold text-secondary">
              {state === "unavailable"
                ? "지도를 불러오지 못했습니다."
                : "지도를 불러오는 중입니다."}
            </p>
          </div>
        ) : null}
        <span className="sr-only" data-map-state={state}>
          {state}
        </span>
      </div>

      <ul className="m-0 max-h-[620px] divide-y divide-line overflow-y-auto p-0">
        {mappableLessons.map((lesson) => {
          const selected = lesson.id === selectedId
          return (
            <li key={lesson.id}>
              <button
                aria-pressed={selected}
                className={[
                  "grid w-full grid-cols-[auto_1fr] gap-3 px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                  selected ? "bg-inset" : "bg-canvas hover:bg-subtle",
                ].join(" ")}
                onClick={() => selectLesson(lesson)}
                type="button"
              >
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-accent"
                  strokeWidth={1.8}
                />
                <span className="min-w-0">
                  <strong className="block break-words text-sm text-primary">{lesson.title}</strong>
                  <span className="mt-1 block break-words text-sm text-secondary">
                    {lesson.venueText}
                  </span>
                  <span className="mt-2 block text-sm font-bold text-primary">
                    {lesson.priceText}
                  </span>
                </span>
              </button>
              {selected ? (
                <Link
                  className="mx-4 mb-4 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
                  href={`/lessons/${lesson.id}`}
                >
                  상세 보기
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MapUnavailable({ message }: Readonly<{ message: string }>) {
  return (
    <div className="grid min-h-[440px] place-items-center border border-line bg-inset p-8 text-center">
      <div className="grid max-w-sm gap-3">
        <MapPin aria-hidden="true" className="mx-auto size-7 text-secondary" strokeWidth={1.8} />
        <p className="m-0 font-bold text-primary">{message}</p>
        <p className="m-0 text-sm text-secondary">
          목록 보기에서 모든 검색 결과를 확인할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
