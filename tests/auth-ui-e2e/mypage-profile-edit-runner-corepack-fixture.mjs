import { chmod, writeFile } from "node:fs/promises"

export async function writeProfileEditCorepack(
  filePath,
  { createSupabaseTemp, logPath, modePath, rawMarkerPath, repoRoot },
) {
  const script = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, "cwd=" + process.cwd() + " " + args.join(" ") + "\\n");

if (${JSON.stringify(createSupabaseTemp)} && args.join(" ") === "pnpm supabase:start") {
  const tempPath = path.join(${JSON.stringify(repoRoot)}, "supabase", ".temp");
  const markerPath = path.join(tempPath, "cli-latest");
  mkdirSync(tempPath, { recursive: true, mode: 0o700 });
  if (!existsSync(markerPath)) writeFileSync(markerPath, "created\\n", { mode: 0o600 });
}
if (args.join(" ") === "pnpm supabase:start") process.exit(0);
if (args.join(" ") === "pnpm supabase:reset") process.exit(0);
if (args.join(" ") === "pnpm supabase:stop") process.exit(0);
if (args.join(" ") === "pnpm supabase:assert-stopped") process.exit(0);
if (args.slice(0, 4).join(" ") === "pnpm exec supabase status") {
  process.stdout.write(JSON.stringify({
    API_URL: "http://127.0.0.1:54321",
    DB_URL: "postgres" + "ql://postgres:postgres@127.0.0.1:54322/postgres",
    PUBLISHABLE_KEY: "sb_" + "publishable_test",
    SECRET_KEY: "sb_" + "secret_test"
  }));
  process.exit(0);
}
if (args.slice(0, 4).join(" ") === "pnpm exec next dev") {
  const port = Number(args.at(-1));
  const server = http.createServer((request, response) => {
    if (request.url === "/api/config/supabase") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ configured: true }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  server.listen(port, "127.0.0.1");
  process.once("SIGTERM", () => {
    appendFileSync(${JSON.stringify(logPath)}, "fake next received SIGTERM\\n");
    server.close(() => process.exit(143));
    setTimeout(() => process.exit(143), 1000);
  });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (args.slice(0, 3).join(" ") === "pnpm exec playwright") {
  const outputDir = process.env.SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR;
  const mode = existsSync(${JSON.stringify(modePath)})
    ? readFileSync(${JSON.stringify(modePath)}, "utf8").trim()
    : "success";
  writeFileSync(${JSON.stringify(rawMarkerPath)}, JSON.stringify({ dir: outputDir }) + "\\n");
  appendFileSync(${JSON.stringify(logPath)}, "playwright-args-json=" + JSON.stringify(args) + "\\n");
  if (outputDir) writeLastRun(outputDir, mode);
  if (mode === "nonzero") {
    process.stderr.write("fake failure user@example.com postgres://postgres:postgres@127.0.0.1:54322/postgres sb_secret_test\\n");
    process.exit(17);
  }
  if (mode === "signal") {
    process.kill(process.pid, "SIGTERM");
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  writeVisualEvidence(process.env.SPOLINK_VISUAL_QA_DIR);
  process.stdout.write(JSON.stringify({ suites: [{ specs: buildSpecs(mode) }] }) + "\\n");
  process.exit(mode === "report-failure" ? 1 : 0);
}
process.stderr.write("unexpected fake corepack command: " + args.join(" ") + "\\n");
process.exit(1);

function writeLastRun(outputDir, mode) {
  mkdirSync(outputDir, { recursive: true, mode: 0o755 });
  if (mode === "stale-output") writeFileSync(path.join(outputDir, "stale.txt"), "stale\\n", { mode: 0o600 });
  if (mode === "malformed-child-result") {
    writeFileSync(path.join(outputDir, ".last-run.json"), "{not-json\\n", { mode: 0o600 });
    return;
  }
  writeFileSync(path.join(outputDir, ".last-run.json"), JSON.stringify({
    failedTests: mode === "misleading-zero-exit" ? ["profile edit failed"] : [],
    status: mode === "misleading-zero-exit" ? "failed" : "passed"
  }) + "\\n", { mode: 0o600 });
}

function buildSpecs(mode) {
  return [
    spec("profile edit auth redirects cover unauthenticated, profile-required, and restricted users"),
    spec("null legacy region requires canonical reselection and first-error focus"),
    spec("profile edit journey saves changed-only fields and persists after retry", mode)
  ];
}

function spec(title, mode = "success") {
  return {
    title,
    tests: [
      {
        projectName: "desktop-chromium",
        results: [{
          error: {
            message: "Error: expect(locator).toBeVisible() failed at /Users/example/project/tests/auth-ui-e2e/mypage-profile-edit.spec.ts:284"
          },
          status: mode === "report-failure" ? "failed" : "passed"
        }]
      },
      { projectName: "tablet-chromium", results: [{ status: "passed" }] },
      { projectName: "mobile-chromium", results: [{ status: "passed" }] }
    ]
  };
}

function writeVisualEvidence(visualDir) {
  if (!visualDir) return;
  mkdirSync(visualDir, { recursive: true, mode: 0o700 });
  writePng(path.join(visualDir, "profile-edit-legacy-desktop-chromium.png"), 1280, 800);
  writePng(path.join(visualDir, "profile-edit-legacy-tablet-chromium.png"), 768, 1024);
  writePng(path.join(visualDir, "profile-edit-legacy-mobile-chromium.png"), 390, 844);
  writePng(path.join(visualDir, "profile-edit-success-desktop-chromium.png"), 1280, 800);
  writePng(path.join(visualDir, "profile-edit-success-tablet-chromium.png"), 768, 1024);
  writePng(path.join(visualDir, "profile-edit-success-mobile-chromium.png"), 390, 844);
  writePng(path.join(visualDir, "profile-edit-validation-mobile-chromium.png"), 390, 844);
  writeFileSync(path.join(visualDir, "observations.jsonl"), [
    "desktop-chromium", "tablet-chromium", "mobile-chromium"
  ].flatMap((project) => [
    { type: "redirects", project },
    { type: "validation", project },
    { type: "scenario", project }
  ]).concat([
    { type: "screenshot", project: "desktop-chromium" },
    { type: "screenshot", project: "tablet-chromium" },
    { type: "screenshot", project: "mobile-chromium" },
    { type: "screenshot", project: "desktop-chromium" },
    { type: "screenshot", project: "tablet-chromium" },
    { type: "screenshot", project: "mobile-chromium" },
    { type: "screenshot", project: "mobile-chromium" }
  ]).map((entry) => JSON.stringify(entry)).join("\\n") + "\\n", { mode: 0o600 });
}

function writePng(filePath, width, height) {
  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = (x + y) % 256;
      raw[offset + 1] = (x * 3) % 256;
      raw[offset + 2] = (y * 5) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  writeFileSync(filePath, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]), { mode: 0o600 });
}

function chunk(type, data) {
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, "ascii");
  data.copy(output, 8);
  output.writeUInt32BE(0, 8 + data.length);
  return output;
}
`
  await writeFile(filePath, script, { mode: 0o700 })
  await chmod(filePath, 0o700)
}
