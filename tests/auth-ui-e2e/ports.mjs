import net from "node:net"

export async function reserveLoopbackPort() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const reservation = await tryReservePort()
    if (reservation.port !== 3002) {
      return {
        baseUrl: `http://127.0.0.1:${reservation.port}`,
        port: reservation.port,
        release: reservation.release,
      }
    }
    await reservation.release()
  }
  throw new Error("Unable to reserve a non-3002 loopback port")
}

export async function isLoopbackPortFree(port) {
  const reservation = await tryReserveSpecificPort(port)
  if (!reservation) return false
  await reservation.release()
  return true
}

async function tryReservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to read reserved port")))
        return
      }
      resolve({ port: address.port, release: () => closeServer(server) })
    })
  })
}

async function tryReserveSpecificPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        resolve(null)
        return
      }
      reject(error)
    })
    server.listen(port, "127.0.0.1", () => {
      resolve({ port, release: () => closeServer(server) })
    })
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
