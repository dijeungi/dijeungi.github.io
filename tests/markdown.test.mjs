import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBlogDocument } from "../app/shared/lib/content.ts";
import { parseMarkdown, serializeMarkdown } from "../app/shared/lib/markdown.ts";

// 실제 저장 검증을 통과한 본문 문서 확인
function checked(content) {
  return parseBlogDocument({
    version: 1,
    id: "d8f87121-2345-4abc-8abc-123456789abc",
    slug: "markdown-test",
    title: "마크다운 변환",
    subtitle: "",
    description: "",
    category: "React",
    date: "2026-11-17",
    readingMinutes: 0,
    updatedAt: "2026-11-17T00:00:00.000Z",
    content,
  }).content;
}

// 중첩된 본문의 특정 요소 수집
function nodes(content, type) {
  const result = [];
  // 하위 본문 요소 순회
  function visit(node) {
    if (node.type === type) result.push(node);
    node.content?.forEach(visit);
  }
  visit(content);
  return result;
}

// 문서의 실제 텍스트 연결
function text(content) {
  return nodes(content, "text").map((node) => node.text).join("");
}

test("DOM 없이 빈 문서와 다국어 소제목을 기존 허용 단계로 변환한다", () => {
  assert.equal(typeof globalThis.window, "undefined");
  const empty = checked(parseMarkdown(""));
  assert.equal(text(empty), "");
  assert.equal(serializeMarkdown(empty), "");
  const content = checked(parseMarkdown("# 한글 😀\n\n## English\n\n### 日本語\n\n###### 마지막"));
  assert.deepEqual(nodes(content, "heading").map((node) => node.attrs.level), [1, 2, 3, 3]);
  assert.equal(text(checked(parseMarkdown(serializeMarkdown(content)))), text(content));
});

test("중첩된 굵게와 기울임 및 취소선과 밑줄 서식을 왕복 변환한다", () => {
  const content = checked(parseMarkdown("**굵게 *기울임*** ~~취소~~ <u>밑줄 **강조**</u>"));
  const italic = nodes(content, "text").find((node) => node.text.includes("기울임"));
  const underline = nodes(content, "text").find((node) => node.text.includes("강조"));
  assert.deepEqual(new Set(italic.marks.map((mark) => mark.type)), new Set(["bold", "italic"]));
  assert.deepEqual(new Set(underline.marks.map((mark) => mark.type)), new Set(["bold", "underline"]));
  assert.ok(nodes(content, "text").find((node) => node.text.includes("취소")).marks.some((mark) => mark.type === "strike"));
  assert.deepEqual(checked(parseMarkdown(serializeMarkdown(content))), content);
});

test("중첩 밑줄과 코드 안의 닫는 태그가 바깥 밑줄을 끊지 않는다", () => {
  const content = checked(parseMarkdown("<u>앞 <u>중첩</u> `</u>` 뒤</u>"));
  assert.equal(text(content), "앞 중첩 </u> 뒤");
  assert.ok(nodes(content, "text").find((node) => node.text.includes("중첩")).marks.some((mark) => mark.type === "underline"));
  assert.ok(nodes(content, "text").find((node) => node.text.includes("뒤")).marks.some((mark) => mark.type === "underline"));
  assert.ok(nodes(content, "text").find((node) => node.text === "</u>").marks.some((mark) => mark.type === "code"));
  assert.deepEqual(checked(parseMarkdown(serializeMarkdown(content))), content);
});

test("일반 HTML과 속성 있는 밑줄 및 이스케이프 표기는 실행 요소가 아닌 텍스트로 남긴다", () => {
  const source = '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<u onclick="alert(1)">본문</u>';
  const content = checked(parseMarkdown(source));
  assert.equal(nodes(content, "image").length, 0);
  assert.ok(text(content).includes('<img src=x onerror="alert(1)">'));
  assert.ok(text(content).includes('<u onclick="alert(1)">본문</u>'));
  assert.equal(nodes(content, "text").some((node) => node.marks?.some((mark) => mark.type === "underline")), false);
  const literal = checked(parseMarkdown(String.raw`\<u>밑줄 아님\</u> \*문자 그대로\*`));
  assert.equal(text(literal), "<u>밑줄 아님</u> *문자 그대로*");
  assert.deepEqual(checked(parseMarkdown(serializeMarkdown(literal))), literal);
});

test("코드 언어와 마지막 줄바꿈 및 코드 안의 긴 백틱을 보존한다", () => {
  const ticks = String.fromCharCode(96);
  const code = 'const value = "' + ticks.repeat(3) + '";\nconst html = "</u>";\n';
  const content = { type: "doc", content: [{ type: "codeBlock", attrs: { language: "tsx" }, content: [{ type: "text", text: code }] }] };
  const source = serializeMarkdown(content);
  assert.ok(source.startsWith(ticks.repeat(4) + "tsx\n"));
  const result = checked(parseMarkdown(source));
  assert.equal(nodes(result, "codeBlock")[0].attrs.language, "tsx");
  assert.equal(text(result), code);
});

test("시작 번호가 있는 순서 목록과 중첩 목록 및 인용문을 유지한다", () => {
  const source = "7. 첫째\n8. 둘째\n   - 중첩 **항목**\n\n> 인용문\n>\n> 다음 문단";
  const content = checked(parseMarkdown(source));
  assert.equal(nodes(content, "orderedList")[0].attrs.start, 7);
  assert.equal(nodes(content, "bulletList").length, 1);
  assert.equal(nodes(content, "blockquote").length, 1);
  const serialized = serializeMarkdown(content);
  assert.match(serialized, /^7\. /m);
  const result = checked(parseMarkdown(serialized));
  assert.equal(nodes(result, "orderedList")[0].attrs.start, 7);
  assert.equal(text(result), text(content));
});

test("명시한 줄바꿈과 수평선을 왕복 변환한다", () => {
  const content = checked(parseMarkdown("첫 줄  \n둘째 줄\\\n셋째 줄\n\n---"));
  assert.equal(nodes(content, "hardBreak").length, 2);
  assert.equal(nodes(content, "horizontalRule").length, 1);
  const result = checked(parseMarkdown(serializeMarkdown(content)));
  assert.equal(nodes(result, "hardBreak").length, 2);
  assert.equal(nodes(result, "horizontalRule").length, 1);
  assert.equal(text(result), text(content));
});

test("Enter 한 번의 줄바꿈과 빈 줄의 문단 구분을 저장하고 복원한다", () => {
  const content = checked(parseMarkdown("첫 줄\r\n**둘째 줄**\n셋째 줄\n\n다음 문단"));
  assert.equal(content.content.length, 2);
  assert.equal(nodes(content, "hardBreak").length, 2);
  assert.deepEqual(content.content[0].content.map((node) => node.type), ["text", "hardBreak", "text", "hardBreak", "text"]);
  assert.ok(nodes(content, "text").find((node) => node.text === "둘째 줄").marks.some((mark) => mark.type === "bold"));
  const source = serializeMarkdown(content);
  const result = checked(parseMarkdown(source));
  assert.deepEqual(result, content);
  assert.equal(serializeMarkdown(result), source);
});

test("목록과 인용문 안의 줄바꿈을 유지하고 코드 내부 줄바꿈은 바꾸지 않는다", () => {
  const content = checked(parseMarkdown("- 첫 줄\n  다음 줄\n- 다음 항목\n\n> 인용 첫 줄\n> 인용 다음 줄\n\n```js\nconst a = 1;\nconst b = 2;\n```"));
  assert.equal(nodes(content, "listItem").length, 2);
  assert.equal(nodes(content, "hardBreak").length, 2);
  assert.equal(nodes(nodes(content, "listItem")[0], "hardBreak").length, 1);
  assert.equal(nodes(nodes(content, "blockquote")[0], "hardBreak").length, 1);
  assert.equal(nodes(content, "codeBlock")[0].content[0].text, "const a = 1;\nconst b = 2;");
  assert.deepEqual(checked(parseMarkdown(serializeMarkdown(content))), content);
});

test("괄호와 Unicode 쿼리가 있는 링크를 유지하고 위험 링크를 실행 링크로 만들지 않는다", () => {
  const content = checked(parseMarkdown("[주소](https://example.com/a_(b)?q=한글&x=1)"));
  const href = nodes(content, "text")[0].marks.find((mark) => mark.type === "link").attrs.href;
  assert.equal(new URL(href).searchParams.get("q"), "한글");
  const result = checked(parseMarkdown(serializeMarkdown(content)));
  assert.equal(nodes(result, "text")[0].marks.find((mark) => mark.type === "link").attrs.href, href);
  const unsafe = checked(parseMarkdown("[실행](javascript:alert(1))"));
  assert.equal(nodes(unsafe, "text").some((node) => node.marks?.some((mark) => mark.type === "link")), false);
});

test("문단 안의 이미지를 블록으로 분리하고 실제 이전 이미지 크기만 복원한다", () => {
  const previous = { type: "doc", content: [{ type: "image", attrs: { src: "/uploads/known.png", alt: "이전 설명", width: 800, height: 450 } }] };
  const before = structuredClone(previous);
  const content = checked(parseMarkdown('앞 ![새 *설명*](/uploads/known.png "제목") 뒤', previous));
  assert.deepEqual(content.content.map((node) => node.type), ["paragraph", "image", "paragraph"]);
  assert.deepEqual(nodes(content, "image")[0].attrs, { src: "/uploads/known.png", alt: "새 설명", title: "제목", width: 800, height: 450 });
  assert.deepEqual(previous, before);
  const fresh = checked(parseMarkdown("![새 이미지](/uploads/new.png)", previous));
  assert.equal(Object.hasOwn(nodes(fresh, "image")[0].attrs, "width"), false);
  assert.equal(Object.hasOwn(nodes(fresh, "image")[0].attrs, "height"), false);
});

test("이미지 앞뒤 Enter는 블록 경계로 처리하고 텍스트 내부 줄바꿈만 유지한다", () => {
  const cases = [
    { source: "앞\n![사진](/uploads/one.png)\n뒤", breaks: 0, images: 1 },
    { source: "![첫째](/uploads/one.png)\n![둘째](/uploads/two.png)", breaks: 0, images: 2 },
    { source: "앞\n한 줄\n![사진](/uploads/one.png)\n뒤\n또 한 줄", breaks: 2, images: 1 },
    { source: "- 앞\n  ![사진](/uploads/one.png)\n  뒤", breaks: 0, images: 1 },
  ];
  for (const entry of cases) {
    const content = checked(parseMarkdown(entry.source));
    assert.equal(nodes(content, "image").length, entry.images);
    assert.equal(nodes(content, "hardBreak").length, entry.breaks);
    assert.ok(nodes(content, "paragraph").every((node) => node.content.length > 0));
    const source = serializeMarkdown(content);
    const result = checked(parseMarkdown(source));
    assert.deepEqual(result, content);
    assert.equal(serializeMarkdown(result), source);
  }
});

test("이미지 설명과 일반 본문의 이스케이프 및 엔티티와 코드 문자를 빠뜨리지 않는다", () => {
  const tick = String.fromCharCode(96);
  const source = String.raw`![\[결과\] \*강조\* \_이름\_ ` + tick + "코드" + tick + String.raw` \<u> &amp; 설명!](/uploads/escaped.png)`;
  const content = checked(parseMarkdown(source));
  assert.equal(nodes(content, "image")[0].attrs.alt, "[결과] *강조* _이름_ 코드 <u> & 설명!");
  const multiline = checked(parseMarkdown("![첫째\n둘째](/uploads/multiline.png)"));
  assert.equal(nodes(multiline, "image")[0].attrs.alt, "첫째\n둘째");
  const body = checked(parseMarkdown(String.raw`\[문자\] \*별\* \_밑줄\_ &amp; &#35;`));
  assert.equal(text(body), "[문자] *별* _밑줄_ & #");
  assert.equal(nodes(body, "text").some((node) => node.marks?.length), false);
});

test("참조 이미지와 목록 및 인용문 내부의 이미지를 저장 가능한 배치로 변환한다", () => {
  const source = '- ![사진][image]\n\n> ![인용 이미지](/uploads/quote.png)\n\n[image]: /uploads/reference.png "이미지 제목"';
  const content = checked(parseMarkdown(source));
  assert.equal(nodes(content, "image").length, 2);
  assert.equal(nodes(content, "image")[0].attrs.title, "이미지 제목");
  assert.equal(nodes(content, "listItem")[0].content[0].type, "paragraph");
  const result = checked(parseMarkdown(serializeMarkdown(content)));
  assert.equal(nodes(result, "image").length, 2);
  assert.equal(nodes(result, "listItem")[0].content[0].type, "paragraph");
});

test("같은 출처의 여러 이미지 크기를 순서대로 보존하고 블록 구분을 유지한다", () => {
  const previous = { type: "doc", content: [
    { type: "image", attrs: { src: "/uploads/same.png", alt: "첫째", width: 800, height: 450 } },
    { type: "image", attrs: { src: "/uploads/same.png", alt: "둘째", width: 320, height: 180 } },
  ] };
  const content = checked(parseMarkdown("![첫째](/uploads/same.png)\n\n![둘째](/uploads/same.png)", previous));
  assert.deepEqual(nodes(content, "image").map((node) => [node.attrs.width, node.attrs.height]), [[800, 450], [320, 180]]);
  const result = checked(parseMarkdown(serializeMarkdown(content), content));
  assert.equal(nodes(result, "image").length, 2);
  assert.deepEqual(nodes(result, "image").map((node) => [node.attrs.width, node.attrs.height]), [[800, 450], [320, 180]]);
});

test("지원 범위 밖의 표와 수학 표기는 새 문서 요소를 만들지 않고 원문 텍스트로 남긴다", () => {
  const content = checked(parseMarkdown("| 제목 | 값 |\n| --- | --- |\n| a | b |\n\n$x+y$"));
  assert.ok(text(content).includes("| 제목 | 값 |"));
  assert.ok(text(content).includes("$x+y$"));
});
