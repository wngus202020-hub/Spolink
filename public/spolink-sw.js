self.addEventListener("push", (event) => {
  const fallback = {
    body: "새 알림이 도착했습니다.",
    notificationId: "spolink-notification",
    title: "SPOLINK",
    url: "/mypage/notifications",
  }
  let payload = fallback

  if (event.data) {
    try {
      const candidate = event.data.json()
      if (
        candidate &&
        typeof candidate === "object" &&
        typeof candidate.title === "string" &&
        typeof candidate.url === "string"
      ) {
        payload = {
          body: typeof candidate.body === "string" ? candidate.body : fallback.body,
          notificationId:
            typeof candidate.notificationId === "string"
              ? candidate.notificationId
              : fallback.notificationId,
          title: candidate.title,
          url: candidate.url.startsWith("/") ? candidate.url : fallback.url,
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      tag: `spolink:${payload.notificationId}`,
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetPath =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/mypage/notifications"
  const targetUrl = new URL(targetPath, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      const existing = clients.find((client) => client.url === targetUrl)
      return existing ? existing.focus() : self.clients.openWindow(targetUrl)
    }),
  )
})
