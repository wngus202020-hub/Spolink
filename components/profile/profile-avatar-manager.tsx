"use client"

import { Camera, LoaderCircle, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ChangeEvent, useEffect, useRef, useState } from "react"

import { Button, buttonClassName } from "@/components/ui/button"
import { removeProfileAvatar, replaceProfileAvatar } from "@/lib/profile/avatar-client"
import {
  PROFILE_AVATAR_ALLOWED_MIME_TYPES,
  PROFILE_AVATAR_BUCKET,
  parseProfileAvatarFile,
} from "@/lib/profile/avatar-contract"
import { getSupabasePublicStorageUrl } from "@/lib/supabase/public-read-client"
import { ProfileAvatar } from "./profile-avatar"

type ProfileAvatarManagerProps = Readonly<{
  displayName: string
  initialAvatarPath: string | null
  initialAvatarUrl: string | null
  userId: string
}>

type PendingAction = "remove" | "replace" | null

export function ProfileAvatarManager({
  displayName,
  initialAvatarPath,
  initialAvatarUrl,
  userId,
}: ProfileAvatarManagerProps) {
  const router = useRouter()
  const alertRef = useRef<HTMLDivElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarPath, setAvatarPath] = useState(initialAvatarPath)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [errorMessage, setErrorMessage] = useState("")
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [successMessage, setSuccessMessage] = useState("")

  useEffect(() => {
    if (errorMessage) alertRef.current?.focus()
  }, [errorMessage])

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0)
    event.target.value = ""
    if (!file || pendingAction) return

    const parsed = parseProfileAvatarFile(file)
    if (parsed.status === "failure") {
      setSuccessMessage("")
      setErrorMessage(profileAvatarFileMessage(parsed.reason))
      return
    }

    setPendingAction("replace")
    setErrorMessage("")
    setSuccessMessage("")
    const result = await replaceProfileAvatar({ currentAvatarPath: avatarPath, file, userId })
    setPendingAction(null)

    if (result.status === "failure") {
      setErrorMessage("사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.")
      return
    }

    const nextUrl = getSupabasePublicStorageUrl(result.avatarPath, PROFILE_AVATAR_BUCKET)
    setAvatarPath(result.avatarPath)
    setAvatarUrl(nextUrl ? `${nextUrl}?v=${Date.now()}` : null)
    setSuccessMessage("프로필 사진을 저장했어요.")
    router.refresh()
  }

  function openDeleteDialog() {
    if (!pendingAction) dialogRef.current?.showModal()
  }

  function closeDeleteDialog() {
    dialogRef.current?.close()
    deleteButtonRef.current?.focus()
  }

  async function confirmDelete() {
    if (!avatarPath || pendingAction) return
    dialogRef.current?.close()
    setPendingAction("remove")
    setErrorMessage("")
    setSuccessMessage("")
    const result = await removeProfileAvatar(avatarPath)
    setPendingAction(null)

    if (result.status === "failure" && result.reason !== "storage") {
      setErrorMessage("사진을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.")
      return
    }

    setAvatarPath(null)
    setAvatarUrl(null)
    setSuccessMessage(
      result.status === "success"
        ? "프로필 사진을 삭제했어요."
        : "사진 표시는 삭제했지만 파일 정리가 지연되고 있어요.",
    )
    router.refresh()
  }

  const busy = pendingAction !== null

  return (
    <section
      aria-labelledby="profile-avatar-heading"
      className="grid gap-4 border-b border-line pb-6"
    >
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-primary" id="profile-avatar-heading">
          프로필 사진
        </h2>
        <p className="m-0 text-sm leading-[1.6] text-secondary">
          레슨과 지도자 프로필에서 나를 알아볼 수 있는 사진이에요.
        </p>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <ProfileAvatar
          className="size-28 border border-line"
          displayName={displayName}
          url={avatarUrl}
        />
        <div className="grid min-w-0 flex-1 gap-3">
          <p className="m-0 text-sm leading-[1.6] text-secondary">
            JPEG, PNG, WebP 파일을 5MB 이하로 등록해 주세요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => fileInputRef.current?.click()} variant="outline">
              {pendingAction === "replace" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Camera aria-hidden="true" className="size-4" strokeWidth={1.8} />
              )}
              {pendingAction === "replace" ? "사진 저장 중" : "사진 선택"}
            </Button>
            {avatarPath ? (
              <button
                className={buttonClassName("ghost")}
                disabled={busy}
                onClick={openDeleteDialog}
                ref={deleteButtonRef}
                type="button"
              >
                <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
                {pendingAction === "remove" ? "삭제 중" : "사진 삭제"}
              </button>
            ) : null}
          </div>
          <input
            accept={PROFILE_AVATAR_ALLOWED_MIME_TYPES.join(",")}
            className="sr-only"
            disabled={busy}
            onChange={selectAvatar}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </div>

      {errorMessage ? (
        <div
          className="rounded-[var(--radius-md)] border border-[color:var(--status-error)] bg-inset px-4 py-3 text-sm font-bold text-primary"
          ref={alertRef}
          role="alert"
          tabIndex={-1}
        >
          {errorMessage}
        </div>
      ) : null}
      {successMessage ? (
        <p
          aria-live="polite"
          className="m-0 rounded-[var(--radius-md)] border border-[color:var(--status-success)] bg-inset px-4 py-3 text-sm font-bold text-primary"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      <dialog
        aria-labelledby="profile-avatar-delete-title"
        className="m-auto w-[min(92vw,440px)] rounded-[var(--radius-lg)] border border-line bg-canvas p-0 text-primary [box-shadow:var(--shadow-panel)] backdrop:bg-primary/45"
        onClose={() => deleteButtonRef.current?.focus()}
        ref={dialogRef}
      >
        <div className="grid gap-5 p-5 md:p-6">
          <div className="grid gap-2">
            <h2 className="m-0 text-xl font-bold" id="profile-avatar-delete-title">
              프로필 사진을 삭제할까요?
            </h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              삭제하면 활동 이름의 첫 글자가 대신 표시돼요.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={closeDeleteDialog} variant="outline">
              취소
            </Button>
            <Button onClick={confirmDelete} variant="secondary">
              <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
              삭제
            </Button>
          </div>
        </div>
      </dialog>
    </section>
  )
}

function profileAvatarFileMessage(reason: "empty" | "size" | "type"): string {
  switch (reason) {
    case "empty":
      return "내용이 없는 파일은 등록할 수 없어요."
    case "size":
      return "프로필 사진은 5MB 이하로 등록해 주세요."
    case "type":
      return "JPEG, PNG, WebP 파일만 등록할 수 있어요."
  }
}
