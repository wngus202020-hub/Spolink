"use client"

import Image from "next/image.js"
import { useState } from "react"

type ProfileAvatarProps = Readonly<{
  className?: string
  displayName: string
  imageClassName?: string
  url: string | null
}>

export function ProfileAvatar({
  className = "size-12",
  displayName,
  imageClassName = "size-full",
  url,
}: ProfileAvatarProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-primary ${className}`}
    >
      {url ? (
        <ProfileAvatarImage
          displayName={displayName}
          imageClassName={imageClassName}
          key={url}
          url={url}
        />
      ) : (
        <ProfileAvatarFallback displayName={displayName} />
      )}
    </span>
  )
}

function ProfileAvatarImage({
  displayName,
  imageClassName,
  url,
}: Readonly<{ displayName: string; imageClassName: string; url: string }>) {
  const [loadFailed, setLoadFailed] = useState(false)
  if (loadFailed) return <ProfileAvatarFallback displayName={displayName} />

  return (
    <Image
      alt={`${displayName} 프로필 사진`}
      className={`object-cover ${imageClassName}`}
      height={112}
      onError={() => setLoadFailed(true)}
      sizes="112px"
      src={url}
      unoptimized
      width={112}
    />
  )
}

function ProfileAvatarFallback({ displayName }: Readonly<{ displayName: string }>) {
  return (
    <span aria-label={`${displayName} 프로필 사진 없음`} className="text-xl font-bold" role="img">
      {displayName.trim().slice(0, 1) || "S"}
    </span>
  )
}
