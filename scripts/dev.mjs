import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

import { startEditorServer } from "./editor-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let running;
let next;
let stopping = false;

// 편집기와 Next 개발 서버 함께 종료
async function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (next && next.exitCode === null) next.kill(signal);
  await running?.close().catch(() => {});
  process.exitCode = exitCode;
}

try {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new Error("글쓰기 기능은 Node.js 24 이상에서 실행해 주세요.");
  running = await startEditorServer({ appRoot });
  console.log("글쓰기 API 준비 완료: /write 에서 글을 작성할 수 있습니다.");
  next = spawn(process.execPath, [resolve(appRoot, "node_modules/next/dist/bin/next"), "dev", ...process.argv.slice(2), "--hostname", "127.0.0.1"], { cwd: appRoot, stdio: "inherit", env: process.env });
  next.once("error", (error) => { console.error(error.message); void stop("SIGTERM", 1); });
  next.once("exit", (code) => { void stop("SIGTERM", code || 0); });
  process.once("SIGINT", () => { void stop("SIGINT"); });
  process.once("SIGTERM", () => { void stop(); });
} catch (error) {
  console.error(error.code === "EADDRINUSE" ? "글쓰기 API 포트가 사용 중입니다. 기존 개발 서버를 종료하거나 EDITOR_API_PORT를 변경해 주세요." : error.message);
  await stop("SIGTERM", 1);
}
