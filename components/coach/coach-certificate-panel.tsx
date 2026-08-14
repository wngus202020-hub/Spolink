"use client"

import { FileBadge2, Trash2, Upload } from "lucide-react"
import { type ChangeEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  createCertificateUpload,
  deleteCoachCertificate,
  registerCoachCertificate,
  uploadCertificateFile,
} from "@/lib/coach-certification/applicant-client"
import type { ApplicantApplicationData } from "@/lib/coach-certification/applicant-types"

export function CoachCertificatePanel({
  application,
  editable,
  onApplication,
  onMessage,
}: Readonly<{
  application: ApplicantApplicationData | null
  editable: boolean
  onApplication: (application: ApplicantApplicationData) => void
  onMessage: (message: string) => void
}>) {
  const [busy, setBusy] = useState(false)
  const [certificateName, setCertificateName] = useState("")
  const [certificateNumber, setCertificateNumber] = useState("")
  const [issuer, setIssuer] = useState("")

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || busy || !editable) return
    if (!application) {
      onMessage("신청 정보를 먼저 임시 저장해요.")
      return
    }
    if (!certificateName.trim()) {
      onMessage("자격증명을 먼저 입력해요.")
      return
    }
    setBusy(true)
    onMessage("")
    const signed = await createCertificateUpload(file)
    if (signed.status === "failure") {
      onMessage(signed.message)
      setBusy(false)
      return
    }
    const uploaded = await uploadCertificateFile(signed.data.uploadUrl, file)
    if (uploaded.status === "failure") {
      onMessage(uploaded.message)
      setBusy(false)
      return
    }
    const registered = await registerCoachCertificate({
      certificateName: certificateName.trim(),
      certificateNumber: certificateNumber.trim() || null,
      issuer: issuer.trim() || null,
      objectName: signed.data.objectName,
    })
    if (registered.status === "failure") onMessage(registered.message)
    else if (registered.data) {
      onApplication(registered.data)
      setCertificateName("")
      setCertificateNumber("")
      setIssuer("")
      onMessage("자격증을 등록했어요.")
    }
    setBusy(false)
  }

  async function remove(certificateId: string) {
    if (busy || !editable || !window.confirm("이 자격증을 삭제할까요?")) return
    setBusy(true)
    const result = await deleteCoachCertificate(certificateId)
    if (result.status === "failure") onMessage(result.message)
    else if (application) {
      onApplication({
        ...application,
        certificates: application.certificates.filter((item) => item.id !== certificateId),
      })
      onMessage("자격증을 삭제했어요.")
    }
    setBusy(false)
  }

  const inputClass =
    "min-h-11 w-full rounded-[var(--radius-sm)] border border-line bg-canvas px-4 py-3 text-sm text-primary disabled:bg-inset"
  return (
    <section aria-labelledby="certificate-heading" className="grid gap-4 border-t border-line pt-6">
      <div>
        <h2 className="m-0 text-2xl font-bold text-primary" id="certificate-heading">
          자격증
        </h2>
        <p className="m-0 mt-1 text-sm text-secondary">
          PNG, JPEG, PDF 파일을 10MB 이하로 등록해요.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-bold text-primary">
          자격증명
          <input
            className={inputClass}
            disabled={busy || !editable}
            maxLength={120}
            onChange={(event) => setCertificateName(event.target.value)}
            value={certificateName}
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-primary">
          발급 기관
          <input
            className={inputClass}
            disabled={busy || !editable}
            maxLength={120}
            onChange={(event) => setIssuer(event.target.value)}
            value={issuer}
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-primary">
          자격 번호
          <input
            className={inputClass}
            disabled={busy || !editable}
            maxLength={100}
            onChange={(event) => setCertificateNumber(event.target.value)}
            value={certificateNumber}
          />
        </label>
      </div>
      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-5 py-3 text-sm font-bold text-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
        <Upload aria-hidden="true" className="size-4" />
        {busy ? "업로드 중" : "자격증 업로드"}
        <input
          accept="image/png,image/jpeg,application/pdf"
          className="sr-only"
          disabled={busy || !editable}
          onChange={upload}
          type="file"
        />
      </label>
      {application?.certificates.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {application.certificates.map((certificate) => (
            <li
              className="flex min-w-0 items-center justify-between gap-3 border-b border-line py-3"
              key={certificate.id}
            >
              <span className="flex min-w-0 items-center gap-3">
                <FileBadge2 aria-hidden="true" className="size-5 shrink-0 text-accent" />
                <span className="truncate text-sm font-bold text-primary">
                  {certificate.certificateName}
                </span>
              </span>
              <Button
                aria-label={`${certificate.certificateName} 삭제`}
                disabled={busy || !editable}
                onClick={() => void remove(certificate.id)}
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-4" />
                삭제
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 rounded-[var(--radius-lg)] bg-subtle p-4 text-sm text-secondary">
          등록된 자격증이 없어요.
        </p>
      )}
    </section>
  )
}
