"use client"

import { MapPin, Search, X } from "lucide-react"
import { type KeyboardEvent, useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { TextInput } from "@/components/ui/form-controls"
import { searchLessonAddresses } from "@/lib/maps/geocoding-client"
import type { GeocodedLocation } from "@/lib/maps/geocoding-contract"

type StoredLocation = Readonly<{
  address: string
  latitude: number | null
  longitude: number | null
}>

export function LessonAddressSearch({
  disabled,
  initial,
}: Readonly<{
  disabled: boolean
  initial: StoredLocation | null
}>) {
  const queryId = useId()
  const [query, setQuery] = useState(initial?.address ?? "")
  const [selected, setSelected] = useState<StoredLocation | null>(initial)
  const [results, setResults] = useState<readonly GeocodedLocation[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function search() {
    const normalized = query.trim()
    if (normalized.length < 2 || searching) {
      setMessage("주소를 두 글자 이상 입력해 주세요.")
      return
    }
    setSearching(true)
    setMessage(null)
    const result = await searchLessonAddresses(normalized)
    setSearching(false)
    if (result.status === "failure") {
      setResults([])
      setMessage(result.message)
      return
    }
    setResults(result.locations)
    setMessage(result.locations.length === 0 ? "검색 결과가 없습니다." : null)
  }

  function selectLocation(location: GeocodedLocation) {
    setSelected(location)
    setQuery(location.address)
    setResults([])
    setMessage("주소를 선택했습니다.")
  }

  function clearSelection() {
    setSelected(null)
    setQuery("")
    setResults([])
    setMessage(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return
    event.preventDefault()
    void search()
  }

  return (
    <fieldset className="grid gap-3 md:col-span-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-bold text-primary">주소</legend>
      <div className="flex min-w-0 gap-2">
        <label className="min-w-0 flex-1" htmlFor={queryId}>
          <span className="sr-only">주소 검색</span>
          <TextInput
            autoComplete="street-address"
            id={queryId}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="도로명 또는 지번 주소"
            type="search"
            value={query}
          />
        </label>
        <Button
          aria-label="주소 검색"
          disabled={searching || query.trim().length < 2}
          onClick={() => void search()}
          title="주소 검색"
          type="button"
        >
          <Search aria-hidden="true" size={18} />
          <span className="hidden sm:inline">검색</span>
        </Button>
      </div>

      {results.length > 0 ? (
        <ul aria-label="주소 검색 결과" className="m-0 divide-y divide-line border border-line p-0">
          {results.map((location) => (
            <li key={`${location.latitude}:${location.longitude}:${location.address}`}>
              <button
                className="grid w-full grid-cols-[auto_1fr] gap-3 bg-canvas px-3 py-3 text-left hover:bg-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onClick={() => selectLocation(location)}
                type="button"
              >
                <MapPin aria-hidden="true" className="mt-0.5 text-secondary" size={18} />
                <span className="min-w-0">
                  <span className="block break-words text-sm font-bold text-primary">
                    {location.address}
                  </span>
                  {location.jibunAddress && location.jibunAddress !== location.address ? (
                    <span className="mt-1 block break-words text-xs text-secondary">
                      지번 {location.jibunAddress}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selected ? (
        <div className="flex min-w-0 items-start gap-3 border-l-2 border-primary bg-inset px-3 py-3">
          <MapPin aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={18} />
          <p className="m-0 min-w-0 flex-1 break-words text-sm font-bold text-primary">
            {selected.address}
          </p>
          <button
            aria-label="선택한 주소 지우기"
            className="grid size-11 shrink-0 place-items-center rounded-full text-secondary hover:bg-canvas hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={clearSelection}
            title="선택한 주소 지우기"
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}
      <input name="address" type="hidden" value={selected?.address ?? ""} />
      <input name="latitude" type="hidden" value={selected?.latitude ?? ""} />
      <input name="longitude" type="hidden" value={selected?.longitude ?? ""} />
      <p aria-live="polite" className="m-0 min-h-5 text-sm text-secondary">
        {message}
      </p>
    </fieldset>
  )
}
