import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "SPOLINK",
  description: "가까운 지도자와 스포츠 레슨을 찾고 예약하는 플랫폼",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="ko">
      <body>{children}</body>
    </html>
  )
}
