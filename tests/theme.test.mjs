import { test } from "node:test";
import { Script } from "node:vm";
import { parse } from "postcss";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { themeInitScript, themeStorageKey } from "../app/shared/theme.ts";

const source = await readFile(new URL("../app/styles/theme.css", import.meta.url), "utf8");
const stylesheet = parse(source);
const { transpileModule, ModuleKind, ScriptTarget } = createRequire(import.meta.url)("typescript");
const hookSource = await readFile(new URL("../app/shared/hooks/useTheme.ts", import.meta.url), "utf8");
const hookModule = transpileModule(hookSource, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;

// 테마 속성으로 선택하는 다크 루트 규칙 확인
function isDarkRule(rule) {
  return rule.selector.split(",").some((selector) => /^:root\[\s*data-theme\s*=\s*(?:"dark"|'dark'|dark)\s*\]$/.test(selector.trim()));
}

// 모드별 루트 선언의 상속과 덮어쓰기 반영
function rootDeclarations(dark) {
  const declarations = new Map();
  for (const mode of dark ? [false, true] : [false]) {
    stylesheet.walkRules((rule) => {
      const selected = mode ? isDarkRule(rule) : rule.selector.split(",").some((selector) => selector.trim() === ":root");
      if (!selected) return;
      for (const node of rule.nodes) {
        if (node.type === "decl") declarations.set(node.prop, node.value);
      }
    });
  }
  return declarations;
}

// 정의된 토큰과 별칭에서 불투명 RGB 색상 해석
function tokenColor(name, declarations, visited = []) {
  assert.ok(declarations.has(name), "정의되지 않은 테마 토큰: " + name);
  assert.ok(!visited.includes(name), "순환하는 테마 토큰: " + [...visited, name].join(" -> "));
  const value = declarations.get(name).trim();
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (reference) return tokenColor(reference[1], declarations, [...visited, name]);
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  assert.ok(match, "텍스트 대비에 사용할 불투명 색상 필요: " + name + " = " + value);
  const hex = match[1].length === 3 ? [...match[1]].map((character) => character + character).join("") : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

// WCAG sRGB 상대 휘도 계산
function luminance(rgb) {
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// 전경과 배경의 WCAG 대비 계산
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

// 브라우저 저장소와 OS 설정만 모의한 실제 초기화 스크립트 실행
function initializeTheme({ stored = null, systemDark = false, blockedStorage = false } = {}) {
  const reads = [];
  const writes = [];
  const queries = [];
  const scope = {
    document: { documentElement: { dataset: {}, style: {} } },
    localStorage: {
      getItem: (key) => {
        reads.push(key);
        if (blockedStorage) throw new Error("모의 저장소 접근 차단");
        return stored;
      },
      setItem: (key, value) => writes.push([key, value]),
    },
    matchMedia: (query) => {
      assert.match(query, /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/);
      queries.push(query);
      return { matches: systemDark };
    },
  };
  scope.window = scope;
  new Script(themeInitScript, { filename: "theme-init.test.js" }).runInNewContext(scope);
  return { theme: scope.document.documentElement.dataset.theme, reads, writes, queries };
}

// 실제 테마 저장소의 구독과 브라우저 이벤트 격리 실행
function themeFixture({ stored = null, systemDark = false, blockedWrites = false, server = false } = {}) {
  const values = new Map(stored === null ? [] : [[themeStorageKey, stored]]);
  const mediaListeners = new Set();
  const storageListeners = new Set();
  const media = {
    matches: systemDark,
    addEventListener: (name, listener) => { assert.equal(name, "change"); mediaListeners.add(listener); },
    removeEventListener: (name, listener) => { assert.equal(name, "change"); mediaListeners.delete(listener); },
  };
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (blockedWrites) throw new Error("모의 설정 저장 실패");
      values.set(key, value);
    },
  };
  const exports = {};
  const modules = {
    "@/app/shared/theme": { themeStorageKey },
    react: { useSyncExternalStore: (_subscribe, getSnapshot, getServerSnapshot) => server ? getServerSnapshot() : getSnapshot() },
  };
  const scope = {
    exports,
    require: (name) => { assert.ok(Object.hasOwn(modules, name), "허용한 모듈만 가져와야 합니다: " + name); return modules[name]; },
  };
  if (!server) {
    Object.assign(scope, {
      localStorage: storage,
      document: { documentElement: { dataset: {} } },
      matchMedia: () => media,
      addEventListener: (name, listener) => { assert.equal(name, "storage"); storageListeners.add(listener); },
      removeEventListener: (name, listener) => { assert.equal(name, "storage"); storageListeners.delete(listener); },
    });
    scope.window = scope;
    new Script(themeInitScript).runInNewContext(scope);
  }
  new Script(hookModule, { filename: "useTheme.test.cjs" }).runInNewContext(scope);
  return {
    api: exports,
    mediaListeners,
    storageListeners,
    get theme() { return scope.document.documentElement.dataset.theme; },
    systemChange: (matches) => {
      media.matches = matches;
      [...mediaListeners].forEach((listener) => listener({ matches }));
    },
    storageChange: (newValue, { key = themeStorageKey, storageArea = storage } = {}) => {
      if (storageArea === storage) {
        if (key === null) values.clear();
        else if (newValue === null) values.delete(key);
        else values.set(key, newValue);
      }
      [...storageListeners].forEach((listener) => listener({ key, newValue, storageArea }));
    },
  };
}

test("초기화는 저장한 밝은 모드와 어두운 모드를 OS 설정보다 우선한다", () => {
  for (const [stored, systemDark] of [["light", true], ["dark", false]]) {
    const result = initializeTheme({ stored, systemDark });
    assert.equal(result.theme, stored);
    assert.deepEqual(result.reads, [themeStorageKey]);
    assert.deepEqual(result.writes, []);
  }
});

test("저장한 선택이 없거나 유효하지 않으면 OS 테마를 기본값으로 사용한다", () => {
  for (const stored of [null, "", "system", "unknown", "DARK"]) {
    for (const systemDark of [false, true]) {
      const result = initializeTheme({ stored, systemDark });
      assert.equal(result.theme, systemDark ? "dark" : "light", JSON.stringify({ stored, systemDark }));
      assert.ok(result.queries.length > 0);
      assert.deepEqual(result.writes, []);
    }
  }
});

test("저장소 접근이 차단되어도 초기화가 중단되지 않고 OS 테마를 적용한다", () => {
  for (const systemDark of [false, true]) {
    const result = initializeTheme({ stored: "dark", systemDark, blockedStorage: true });
    assert.equal(result.theme, systemDark ? "dark" : "light");
    assert.deepEqual(result.writes, []);
  }
});

test("첫 구독자가 해제되어도 시스템 동기화를 유지하고 마지막 구독에서 정리한다", () => {
  const fixture = themeFixture();
  let firstUpdates = 0;
  let secondUpdates = 0;
  const first = fixture.api.subscribeTheme(() => { firstUpdates += 1; });
  const second = fixture.api.subscribeTheme(() => { secondUpdates += 1; });
  assert.equal(fixture.mediaListeners.size, 1);
  assert.equal(fixture.storageListeners.size, 1);
  fixture.systemChange(true);
  assert.equal(fixture.theme, "dark");
  assert.ok(firstUpdates > 0);
  assert.ok(secondUpdates > 0);
  first();
  const firstCount = firstUpdates;
  const secondCount = secondUpdates;
  fixture.systemChange(false);
  assert.equal(fixture.theme, "light");
  assert.equal(firstUpdates, firstCount);
  assert.ok(secondUpdates > secondCount);
  assert.equal(fixture.mediaListeners.size, 1);
  second();
  assert.equal(fixture.mediaListeners.size, 0);
  assert.equal(fixture.storageListeners.size, 0);
  fixture.systemChange(true);
  assert.equal(fixture.theme, "light");
});

test("설정 저장에 실패한 수동 선택을 OS 변경과 구독 재연결에서도 유지한다", () => {
  const fixture = themeFixture({ blockedWrites: true });
  const first = fixture.api.subscribeTheme(() => {});
  fixture.api.setTheme("dark");
  assert.equal(fixture.theme, "dark");
  fixture.systemChange(true);
  fixture.systemChange(false);
  assert.equal(fixture.theme, "dark");
  first();
  const second = fixture.api.subscribeTheme(() => {});
  assert.equal(fixture.theme, "dark");
  second();
});

test("관련 저장소 변경만 반영하고 설정 삭제와 잘못된 값은 시스템 테마로 돌아간다", () => {
  const fixture = themeFixture();
  const stop = fixture.api.subscribeTheme(() => {});
  fixture.storageChange("dark", { key: "other-setting" });
  fixture.storageChange("dark", { storageArea: {} });
  assert.equal(fixture.theme, "light");
  fixture.storageChange("dark");
  assert.equal(fixture.theme, "dark");
  fixture.systemChange(false);
  assert.equal(fixture.theme, "dark");
  fixture.systemChange(true);
  fixture.storageChange("light");
  assert.equal(fixture.theme, "light");
  fixture.storageChange(null);
  assert.equal(fixture.theme, "dark");
  fixture.systemChange(false);
  assert.equal(fixture.theme, "light");
  fixture.storageChange("dark");
  fixture.storageChange(null, { key: null });
  assert.equal(fixture.theme, "light");
  fixture.systemChange(true);
  fixture.storageChange("invalid");
  assert.equal(fixture.theme, "dark");
  stop();
});

test("훅은 서버에서 브라우저 API 없이 렌더하고 전환 동작은 현재 문서 모드를 기준으로 한다", () => {
  const server = themeFixture({ server: true });
  assert.equal(server.api.useTheme().theme, "light");
  const fixture = themeFixture({ systemDark: true });
  const stop = fixture.api.subscribeTheme(() => {});
  const { theme, toggleTheme } = fixture.api.useTheme();
  assert.equal(theme, "dark");
  toggleTheme();
  assert.equal(fixture.theme, "light");
  toggleTheme();
  assert.equal(fixture.theme, "dark");
  stop();
});

test("native control 색상과 단일 다크 팔레트가 테마 속성에 맞게 적용된다", () => {
  const light = rootDeclarations(false);
  const dark = rootDeclarations(true);
  let darkRules = 0;
  stylesheet.walkRules((rule) => { if (isDarkRule(rule)) darkRules += 1; });
  assert.equal(darkRules, 1, "data-theme=dark에서 사용하는 루트 팔레트는 한 곳이어야 합니다.");
  assert.equal(light.get("color-scheme"), "light");
  assert.equal(dark.get("color-scheme"), "dark");
});

test("실제 다크 토큰의 본문과 상태 안내 및 코드 대비가 WCAG AA 4.5 이상이다", () => {
  const declarations = rootDeclarations(true);
  const pairs = [
    ["본문", "--foreground", "--background"],
    ["일반 표면", "--theme-text", "--theme-surface"],
    ["보조 텍스트", "--theme-text-secondary", "--theme-surface"],
    ["약한 텍스트", "--theme-text-muted", "--theme-surface"],
    ["호버 표면의 약한 텍스트", "--theme-text-muted", "--theme-surface-hover"],
    ["링크", "--theme-accent", "--theme-surface"],
    ["강조 버튼", "--theme-on-accent", "--theme-accent"],
    ["카테고리 배지", "--theme-accent-text", "--theme-accent-soft"],
    ["코드 본문", "--theme-code-text", "--theme-code-surface"],
    ["코드 툴바", "--theme-text-secondary", "--theme-code-toolbar"],
    ["성공 안내", "--theme-success-text", "--theme-success-bg"],
    ["오류 안내", "--theme-error-text", "--theme-error-bg"],
    ["일반 안내", "--theme-notice-text", "--theme-notice-bg"],
    ["툴팁 본문", "--theme-tooltip-text", "--theme-tooltip-bg"],
    ["툴팁 보조 텍스트", "--theme-tooltip-muted", "--theme-tooltip-bg"],
    ["선택한 텍스트", "--theme-selection-text", "--theme-selection-background"],
  ];
  const failures = [];
  for (const [role, foreground, background] of pairs) {
    const ratio = contrast(tokenColor(foreground, declarations), tokenColor(background, declarations));
    if (ratio < 4.5) failures.push({ role, foreground, background, ratio: Number(ratio.toFixed(2)) });
  }
  assert.deepEqual(failures, [], "주요 일반 텍스트의 대비가 4.5:1 이상이어야 합니다.");
});
