"use client"

import { ExternalLink } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

type CertificateReadButtonProps = Readonly<{
  certificateId: string
  coachProfileId: string
}>

export function CertificateReadButton({
  certificateId,
  coachProfileId,
}: CertificateReadButtonProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function openCertificate() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/coach-profiles/${coachProfileId}/certificates/${certificateId}`,
        { cache: "no-store" },
      )
      const body: unknown = await response.json()
      const readUrl = readSignedUrl(body)
      if (!response.ok || !readUrl) {
        setError("자격증 파일을 열 수 없습니다. 다시 시도해 주세요.")
        return
      }
      window.open(readUrl, "_blank", "noopener,noreferrer")
    } catch (caught) {
      if (caught instanceof TypeError) {
        setError("네트워크 연결을 확인해 주세요.")
        return
      }
      throw caught
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid justify-items-end gap-1">
      <Button disabled={pending} onClick={openCertificate} variant="outline">
        <ExternalLink aria-hidden="true" className="size-4" />
        {pending ? "여는 중" : "자격증 보기"}
      </Button>
      {error ? (
        <p
          aria-live="polite"
          className="m-0 max-w-52 text-right text-xs text-[var(--status-error)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function readSignedUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const data = Object.entries(value).find(([key]) => key === "data")?.[1]
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null
  const readUrl = Object.entries(data).find(([key]) => key === "readUrl")?.[1]
  return typeof readUrl === "string" && readUrl.length > 0 ? readUrl : null
}
