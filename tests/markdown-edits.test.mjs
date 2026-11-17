import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown } from "../app/shared/lib/markdown.ts";
import { getFirstContentImage } from "../app/shared/lib/content.ts";
import { getMarkdownEdit, getMarkdownImageEdit, getMarkdownIndentEdit } from "../app/(routes)/(public)/write/_lib/markdown-edits.ts";

test("선택한 여러 줄의 서식을 바꾸고 다음 줄은 보존한다", () => {
  const source = "첫 줄\n다음 줄\n마지막";
  const edit = getMarkdownEdit(source, 0, 9, "numbers");
  assert.equal(edit.value, "1. 첫 줄\n2. 다음 줄\n마지막");
  const undone = getMarkdownEdit(edit.value, edit.start, edit.end, "numbers");
  assert.equal(undone.value, source);
  assert.equal(getMarkdownEdit("\n제목", 0, 0, "heading2").value, "## \n제목");
});

test("강조 도구는 선택을 유지하고 같은 서식을 다시 누르면 해제한다", () => {
  const edit = getMarkdownEdit("앞 강조 뒤", 2, 4, "bold");
  assert.equal(edit.value, "앞 **강조** 뒤");
  assert.equal(edit.value.slice(edit.start, edit.end), "강조");
  assert.equal(getMarkdownEdit(edit.value, edit.start, edit.end, "bold").value, "앞 강조 뒤");
});

test("선택한 여러 줄에 Tab을 적용해도 내용이 지워지지 않는다", () => {
  const source = "한 줄\n두 줄\n다음";
  const edit = getMarkdownIndentEdit(source, 0, 8);
  assert.equal(edit.value, "  한 줄\n  두 줄\n다음");
  const outdent = getMarkdownIndentEdit(edit.value, edit.start, edit.end, true);
  assert.equal(outdent.value, source);
  assert.equal(getMarkdownIndentEdit("abc", 1, 1).value, "a  bc");
  assert.equal(getMarkdownIndentEdit("  abc", 3, 3, true).value, "abc");
});

test("코드 안의 연속 백틱보다 긴 fence로 원문을 보존한다", () => {
  const codeCharacter = String.fromCharCode(96);
  const source = "const example = '" + codeCharacter.repeat(4) + "';";
  const edit = getMarkdownEdit(source, 0, source.length, "code");
  const body = parseMarkdown(edit.value).content;
  assert.equal(body.length, 1);
  assert.equal(body[0].type, "codeBlock");
  assert.equal(body[0].content[0].text, source);
  assert.equal(body[0].attrs.language, "tsx");
});

test("업로드 이미지의 설명에 마크다운과 HTML 기호가 있어도 글자를 그대로 유지한다", () => {
  const alt = "화면 [결과] *강조* _이름_ " + String.fromCharCode(96) + "코드" + String.fromCharCode(96) + " <u> & 설명!";
  const edit = getMarkdownImageEdit("앞\n\n뒤", 3, 3, "/uploads/photo(1).png", alt);
  const image = getFirstContentImage(parseMarkdown(edit.value));
  assert.equal(image.alt, alt);
  assert.equal(image.src, "/uploads/photo(1).png");
  assert(edit.value.startsWith("앞\n\n"));
  assert(edit.value.endsWith("\n\n뒤"));
});

test("링크 도구가 대괄호와 주소의 괄호를 안전한 문법으로 입력한다", () => {
  const edit = getMarkdownEdit("a[b]", 0, 4, "link", "https://example.com/(a)");
  const node = parseMarkdown(edit.value).content[0].content[0];
  assert.equal(node.text, "a[b]");
  assert.equal(node.marks.find((mark) => mark.type === "link").attrs.href, "https://example.com/(a)");
});
