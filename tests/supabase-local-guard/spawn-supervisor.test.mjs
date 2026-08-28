import assert from "node:assert/strict"
import { watch } from "node:fs"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os, { constants as osConstants } from "node:os"
import path from "node:path"
import process from "node:process"
import test from "node:test"

import { runSpawn } from "../../scripts/supabase-local.mjs"
import { baseEnv } from "./helpers.mjs"

test("supervisor preserves normal exit and output", async () => {
  const result = await runNode(
    "process.stdout.write('ok');process.stderr.write('note');process.exit(7)",
  )
  assert.deepEqual(result, { exitCode: 7, stdout: "ok", stderr: "note" })
})

test("supervisor waits after the direct child exits until its descendant is gone", async () => {
  for (const releaseTiming of ["pre-existing", "subsequently-created"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "spolink-supervisor-"))
    const ready = path.join(root, "ready")
    const release = path.join(root, "release")
    const directPidPath = path.join(root, "direct-pid")
    try {
      if (releaseTiming === "pre-existing") await writeFile(release, "release")
      const descendant = `
        const {watch,writeFileSync}=require("node:fs");
        const {access}=require("node:fs/promises");
        let settled=false;
        const watcher=watch(${JSON.stringify(root)},(eventType,filename)=>{
          if(eventType==="rename"&&filename==="release") void checkRelease();
        })
        watcher.once("error", finish);
        const timer=setTimeout(()=>finish(new Error("Timed out waiting for release")),1000);
        void checkRelease();
        writeFileSync(${JSON.stringify(ready)}, "watcher-and-check-armed");
        async function checkRelease(){
          if(settled) return;
          try { await access(${JSON.stringify(release)}); finish(); }
          catch(error) { if(error?.code!=="ENOENT") finish(error); }
        }
        function finish(error){
          if(settled) return;
          settled=true;
          clearTimeout(timer);
          watcher.close();
          process.exitCode=error?1:0;
          process.exit();
        }
      `
      const command = `
        const child=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"});
        child.unref();
        require("node:fs").writeFileSync(${JSON.stringify(directPidPath)},String(process.pid));
        process.on("exit",()=>require("node:fs").writeFileSync(${JSON.stringify(
          path.join(root, "direct-exited"),
        )},"yes"));
      `
      let settled = false
      const running = runNode(command, 5_000).finally(() => {
        settled = true
      })
      await waitForPathEvent(ready)
      assert.equal(await readFile(ready, "utf8"), "watcher-and-check-armed")
      const directPid = Number(await readFile(directPidPath, "utf8"))
      await waitForPathEvent(path.join(root, "direct-exited"))
      assert.equal(isAlive(directPid), false)
      if (releaseTiming === "subsequently-created") {
        assert.equal(settled, false)
        await writeFile(release, "release")
      }
      assert.equal((await running).exitCode, 0, `${releaseTiming} release did not complete`)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  }
})

test("timeout TERM lets a responder exit during grace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-supervisor-"))
  const terminated = path.join(root, "terminated")
  try {
    const result = await runNode(
      `process.on("SIGTERM",()=>{require("node:fs").writeFileSync(${JSON.stringify(terminated)},"yes");process.exit(0)});setInterval(()=>{},1000)`,
      100,
    )
    assert.equal(result.exitCode, 124)
    await access(terminated)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("timeout KILL removes a TERM-ignoring command and leaves an unrelated process alive", async () => {
  const other = (await import("node:child_process")).spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    {
      detached: true,
      stdio: "ignore",
    },
  )
  let taskPid
  try {
    const result = await runNode(
      "process.on('SIGTERM',()=>{});process.stdout.write(String(process.pid));setInterval(()=>{},1000)",
      100,
    )
    taskPid = Number(result.stdout)
    assert.equal(result.exitCode, 124)
    assert.equal(isAlive(taskPid), false)
    assert.equal(isAlive(other.pid), true)
  } finally {
    if (other.pid && isAlive(other.pid)) process.kill(-other.pid, "SIGKILL")
  }
})

test("supervisor preserves command signal semantics", async () => {
  const result = await runNode("process.kill(process.pid,'SIGUSR2')")
  assert.equal(result.signal, "SIGUSR2")
  assert.equal(result.exitCode, 128 + osConstants.signals.SIGUSR2)
})

test("captured diagnostic output is byte-bounded and redacts structured, assignment, split, and fixture secrets", async () => {
  const secrets = [
    "repo-service-role-secret",
    "quoted-anon-secret",
    "unquoted-publishable-secret",
    "secret-key-secret",
    "provider-payment-key-secret",
    "payment-token-secret",
    "jwt-assignment-secret",
    "split-service-role-secret",
    "local-provider-123",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature",
  ]
  const result = await runNode(
    `
      process.stdout.write("x".repeat(100000)+'{"service_role_key":"repo-service-role-secret","status":"healthy"}\\nANON_KEY="quoted-anon-secret" publishable_key=unquoted-publishable-secret SECRET_KEY=secret-key-secret provider_payment_key=provider-payment-key-secret payment_token=payment-token-secret jwt=jwt-assignment-secret\\n',()=>process.stderr.write("local-provider-123 authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature cookie=session-cookie-value status=healthy\\n",()=>process.exit(1)))
    `,
    5_000,
  )
  const splitResult = await runNode(
    "process.stdout.write('service_role_key=split-service-',()=>process.stdout.write('role-secret\\n',()=>process.exit(1)))",
  )
  assert.ok(Buffer.byteLength(result.stdout) <= 16_384)
  assert.ok(Buffer.byteLength(result.stderr) <= 16_384)
  assert.ok(Buffer.byteLength(splitResult.stdout) <= 16_384)
  const diagnostics = `${result.stdout}${result.stderr}${splitResult.stdout}${splitResult.stderr}`
  for (const secret of secrets) assert.equal(diagnostics.includes(secret), false)
  assert.doesNotMatch(diagnostics, /session-cookie-value/u)
  assert.match(result.stdout, /"service_role_key":"\[REDACTED\]"/u)
  assert.match(result.stdout, /status":"healthy/u)
  assert.match(result.stderr, /status=healthy/u)
  assert.match(result.stdout, /redacted/i)
  assert.match(result.stderr, /redacted/i)
})

test("only an explicit successful parser contract receives bounded operational stdout", async () => {
  const result = await runSpawn({
    command: process.execPath,
    args: ["-e", 'process.stdout.write(\'{"API_URL":"http://127.0.0.1:54321"}\')'],
    options: { shell: false, env: baseEnv },
    preserveStdoutOnSuccess: true,
    timeoutMs: 1_000,
  })
  assert.equal(JSON.parse(result.stdout).API_URL, "http://127.0.0.1:54321")
  assert.ok(Buffer.byteLength(result.stdout) <= 16_384)
})

test("unsupported process-group semantics fail closed", async () => {
  if (process.platform !== "win32") return
  await assert.rejects(() => runNode("process.exit(0)"), /POSIX/)
})

function runNode(source, timeoutMs = 1_000) {
  return runSpawn({
    command: process.execPath,
    args: ["-e", source],
    options: { shell: false, env: baseEnv },
    timeoutMs,
  })
}

async function waitForPathEvent(filePath) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`Timed out waiting for ${path.basename(filePath)}`)),
      1_000,
    )
    const watcher = watch(path.dirname(filePath), (eventType, filename) => {
      if (eventType !== "rename" || filename !== path.basename(filePath)) return
      void access(filePath)
        .then(() => finish())
        .catch(finish)
    })
    void access(filePath)
      .then(() => finish())
      .catch((error) => {
        if (error?.code !== "ENOENT") finish(error)
      })

    function finish(error) {
      clearTimeout(timer)
      watcher.close()
      if (error) reject(error)
      else resolve()
    }
  })
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
