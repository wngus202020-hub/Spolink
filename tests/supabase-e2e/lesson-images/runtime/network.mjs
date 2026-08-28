import net from "node:net"

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
}

export function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

export function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.once("end", () => resolve(Buffer.concat(chunks)))
    request.once("error", reject)
  })
}

export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, "127.0.0.1")
  })
}

export async function selectPort(first) {
  for (let port = first; port < first + 200; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error("No free port for isolated lesson-image Next")
}

export async function waitForPortFree(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isPortFree(port)) return
    await delay(250)
  }
  throw new Error("Owned Next port was not released")
}
