import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { lstat, open, readdir, unlink } from "node:fs/promises";

import { parseBlogDocument } from "../app/shared/lib/content.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const mediaName = new RegExp("^(" + uuid + ")\\.(png|jpg|gif|webp)$", "i");
const draftName = new RegExp("^" + uuid + "\\.json$", "i");
const digestPattern = /^[0-9a-f]{64}$/;

// 정리 대상 경로가 속한 실제 폴더와 링크 경계 확인
async function checkParents(appRoot, path) {
  const root = resolve(appRoot);
  const target = resolve(path);
  const suffix = relative(root, target);
  if (!suffix || suffix === ".." || suffix.startsWith("../") || isAbsolute(suffix)) throw new Error("이미지 정리 경로를 확인해 주세요.");
  const directories = [root];
  let current = root;
  for (const part of relative(root, dirname(target)).split("/").filter(Boolean)) {
    current = join(current, part);
    directories.push(current);
  }
  for (const directory of directories) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("이미지 정리 폴더에 심볼릭 링크를 사용할 수 없습니다.");
  }
  return target;
}

// 파일의 종류와 읽기 이후 변경 여부 확인
function matches(stat, snapshot) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.dev === snapshot.dev && stat.ino === snapshot.ino
    && stat.mtimeMs === snapshot.mtimeMs && stat.size === snapshot.size && stat.mode === snapshot.mode;
}

// 링크를 따라가지 않고 파일 바이트와 삭제 검증용 스냅샷 읽기
export async function readCleanupFile(appRoot, path) {
  let handle;
  try {
    const target = await checkParents(appRoot, path);
    const previous = await lstat(target);
    if (!previous.isFile() || previous.isSymbolicLink()) throw new Error("이미지 정리 파일 경로를 확인해 주세요.");
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!matches(opened, previous)) throw new Error("이미지 정리 파일이 변경됐습니다.");
    const bytes = await handle.readFile();
    await checkParents(appRoot, target);
    if (!matches(await handle.stat(), opened) || !matches(await lstat(target), opened)) throw new Error("이미지 정리 파일이 변경됐습니다.");
    return { path: target, bytes, mode: opened.mode, dev: opened.dev, ino: opened.ino, mtimeMs: opened.mtimeMs, size: opened.size };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close(); }
}

// 계획 이후 같은 파일로 유지된 정리 대상만 삭제
export async function removeCleanupFile(appRoot, snapshot) {
  const current = await readCleanupFile(appRoot, snapshot.path);
  if (!current || !matches(await lstat(current.path), snapshot) || !current.bytes.equals(snapshot.bytes)) throw new Error("이미지 정리 대상이 변경됐습니다.");
  await checkParents(appRoot, current.path);
  if (!matches(await lstat(current.path), snapshot)) throw new Error("이미지 정리 대상이 변경됐습니다.");
  await unlink(current.path);
}

// 실패한 발행에서 비어 있는 원래 경로에만 이미지 복구
export async function restoreCleanupFile(appRoot, snapshot) {
  const path = await checkParents(appRoot, snapshot.path);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, snapshot.mode & 0o777);
  try {
    await handle.writeFile(snapshot.bytes);
    await handle.chmod(snapshot.mode & 0o777);
  } finally { await handle.close(); }
}

// 문서의 모든 문자열에서 인코딩된 로컬 이미지 참조도 보수적으로 수집
function references(document) {
  const ids = new Set();
  // 본문과 마크다운 및 링크에 남은 이미지 식별자 수집
  function visit(value) {
    if (typeof value === "string") {
      let text = value;
      for (let index = 0; ; index++) {
        for (const match of text.matchAll(new RegExp("/uploads/(" + uuid + "\\.(?:png|jpg|gif|webp))(?=$|[^a-z0-9.])", "ig"))) {
          ids.add(match[1].split(".")[0].toLowerCase());
        }
        for (const match of text.matchAll(new RegExp("/__editor/api/media/(" + uuid + ")(?=$|[^a-z0-9-])", "ig"))) ids.add(match[1].toLowerCase());
        let decoded;
        try { decoded = decodeURIComponent(text); } catch { decoded = text.replace(/%([0-9a-f]{2})/ig, (_, code) => String.fromCharCode(parseInt(code, 16))); }
        if (decoded === text) break;
        if (index >= 15) throw new Error("이미지 참조의 인코딩을 확인해 주세요.");
        text = decoded;
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(document);
  return { ids };
}

// 이전 글에서 실제 이미지로 사용된 로컬 공개 파일만 후보 수집
function previousImageNames(document) {
  const names = new Set();
  // 상대 공개 경로와 루프백 이미지 주소의 파일명 확인
  function collect(source) {
    if (typeof source !== "string") return;
    try {
      const url = new URL(source, "http://localhost");
      const relativeSource = source.startsWith("/") && !source.startsWith("//");
      const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (!["http:", "https:"].includes(url.protocol) || !localHost || (!relativeSource && !/^https?:\/\//i.test(source))) return;
      const match = decodeURIComponent(url.pathname).match(new RegExp("^/uploads/(" + uuid + "\\.(?:png|jpg|gif|webp))$", "i"));
      if (match) names.add(match[1].toLowerCase());
    } catch { return; }
  }
  // 본문 안의 실제 이미지 노드만 순회
  function visit(node) {
    if (node?.type === "image") collect(node.attrs?.src);
    node?.content?.forEach(visit);
  }
  collect(document?.heroImage?.src);
  visit(document?.content);
  return names;
}

// 안전한 문서 폴더에서 글 파일만 읽고 검증
async function readDocuments(appRoot, directory, accepts, published) {
  let names;
  try {
    await checkParents(appRoot, join(directory, ".scan"));
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const documents = [];
  for (const name of names.filter(accepts)) {
    const file = await readCleanupFile(appRoot, join(directory, name));
    if (!file) throw new Error("이미지 참조를 확인하는 중 글 파일이 변경됐습니다.");
    const raw = JSON.parse(file.bytes.toString("utf8"));
    const parsed = parseBlogDocument(raw, { publish: published });
    documents.push({ raw, parsed });
  }
  return documents;
}

// 같은 글의 이전 공개본을 제외한 저장된 전체 문서의 참조 확인
async function protectedIds(appRoot, publication, repoRoot, git) {
  const posts = await readDocuments(appRoot, join(appRoot, "content/posts"), name => name.endsWith(".json"), true);
  const drafts = await readDocuments(appRoot, join(appRoot, ".editor/drafts"), name => draftName.test(name), false);
  const ids = references(publication).ids;
  for (const { raw, parsed } of [...posts.filter(item => item.parsed.id !== publication.id), ...drafts]) {
    for (const id of references(raw).ids) ids.add(id);
    for (const id of references(parsed).ids) ids.add(id);
  }
  const directory = relative(resolve(repoRoot), join(resolve(appRoot), "content/posts"));
  if (directory === ".." || directory.startsWith("../") || isAbsolute(directory)) throw new Error("글의 Git 저장 경로를 확인해 주세요.");
  for (const [revision, args] of [
    ["HEAD", ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", directory]],
    ["", ["ls-files", "-z", "--", directory]],
  ]) {
    const names = new Set((await git(args)).split("\0").filter(name => name.endsWith(".json")));
    for (const name of names) {
      const raw = JSON.parse(await git(["show", revision + ":" + name]));
      const parsed = parseBlogDocument(raw, { publish: true });
      if (parsed.id === publication.id) continue;
      for (const id of references(raw).ids) ids.add(id);
      for (const id of references(parsed).ids) ids.add(id);
    }
  }
  return ids;
}

// 원본 파일의 SHA-256 정리 검증값 계산
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Git에 기록된 원본과 인덱스 및 작업 파일이 모두 같은지 확인
async function cleanTrackedImage(repoRoot, path, git) {
  const name = relative(resolve(repoRoot), path);
  if (name === ".." || name.startsWith("../") || isAbsolute(name)) throw new Error("이미지의 Git 저장 경로를 확인해 주세요.");
  const tracked = await git(["ls-files", "--stage", "--", name]);
  if (!/^100(?:644|755) [0-9a-f]+ 0\t/.test(tracked)) return false;
  if (await git(["diff", "--cached", "HEAD", "--name-only", "--", name])) return false;
  if (await git(["diff", "--name-only", "--", name])) return false;
  return await git(["hash-object", "--no-filters", "--", name]) === await git(["rev-parse", "HEAD:" + name]);
}

// 같은 업로드의 로컬 원본과 메타데이터만 정리 계획에 포함
async function localSnapshots(appRoot, name, expected) {
  const [, id, extension] = name.match(mediaName);
  const metadata = await readCleanupFile(appRoot, join(appRoot, ".editor/media", id + ".json"));
  const binary = await readCleanupFile(appRoot, join(appRoot, ".editor/media", name));
  if (metadata) {
    const value = JSON.parse(metadata.bytes.toString("utf8"));
    if (value.id !== id || value.extension !== extension) throw new Error("정리할 이미지의 메타데이터가 다릅니다.");
  }
  if (binary && (!metadata || digest(binary.bytes) !== expected)) throw new Error("정리할 이미지 원본이 변경됐습니다.");
  return [binary, metadata].filter(Boolean);
}

// 이전 발행 이미지와 보류 기록에 한정한 미사용 이미지 정리 계획
export async function prepareMediaCleanup({ appRoot, repoRoot, publication, previous, candidates = [], git }) {
  const retained = new Map();
  const assets = [];
  const selected = new Map();
  const currentImages = references(publication).ids;
  for (const candidate of candidates) {
    if (!candidate || !mediaName.test(candidate.name) || !digestPattern.test(candidate.digest)) throw new Error("이미지 정리 기록을 확인해 주세요.");
    const name = candidate.name.toLowerCase();
    if (currentImages.has(name.split(".")[0])) continue;
    if (selected.has(name) && selected.get(name) !== candidate.digest) throw new Error("이미지 정리 기록이 서로 다릅니다.");
    selected.set(name, candidate.digest);
    retained.set(name, candidate.digest);
  }
  for (const name of previousImageNames(previous)) if (!selected.has(name) && !currentImages.has(name.split(".")[0])) selected.set(name, null);
  const protectedImages = await protectedIds(appRoot, publication, repoRoot, git);
  for (const [name, expected] of selected) {
    const publicFile = await readCleanupFile(appRoot, join(appRoot, "public/uploads", name));
    let checksum = expected;
    if (publicFile) {
      if (!await cleanTrackedImage(repoRoot, publicFile.path, git)) continue;
      checksum = digest(publicFile.bytes);
      if (expected && checksum !== expected) continue;
    } else if (!expected) continue;
    const localFiles = await localSnapshots(appRoot, name, checksum);
    retained.set(name, checksum);
    if (!protectedImages.has(name.split(".")[0])) assets.push({ name, digest: checksum, publicFile, localFiles });
  }
  return { assets, pending: [...retained].map(([name, checksum]) => ({ name, digest: checksum })) };
}

// 푸시 성공 뒤 저장된 참조와 파일 변경 여부를 재확인한 로컬 원본 정리
export async function finishMediaCleanup({ appRoot, repoRoot, publication, assets, git }) {
  const protectedImages = await protectedIds(appRoot, publication, repoRoot, git);
  const completed = [];
  for (const asset of assets) {
    if (protectedImages.has(asset.name.split(".")[0])) continue;
    for (const file of asset.localFiles) {
      const current = await readCleanupFile(appRoot, file.path);
      if (current && (!matches(await lstat(current.path), file) || !current.bytes.equals(file.bytes))) throw new Error("정리할 이미지 원본이 변경됐습니다.");
    }
    for (const file of asset.localFiles) {
      if (await readCleanupFile(appRoot, file.path)) await removeCleanupFile(appRoot, file);
    }
    completed.push(asset.name);
  }
  return completed;
}
