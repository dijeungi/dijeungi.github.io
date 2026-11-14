import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import assert from "node:assert/strict";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";

import {
  toArticlePost,
  slugifyTitle,
  parseBlogDocument,
  isSafeContentUrl,
  createEmptyDocument,
  estimateReadingMinutes,
} from "../app/shared/lib/content.ts";

// 검증에 사용할 기본 글 문서 생성
function document(overrides = {}) {
  return {
    version: 1,
    id: "d8f87121-2345-4abc-8abc-123456789abc",
    slug: "first-post",
    title: "첫 번째 글",
    description: "검색 설명",
    category: "React",
    date: "2026-11-14",
    readingMinutes: 0,
    updatedAt: "2026-11-14T06:00:00.000Z",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "본문입니다." }] }],
    },
    ...overrides,
  };
}

test("빈 임시 글을 저장하고 기본 정보를 채워 미리 볼 수 있다", () => {
  const draft = parseBlogDocument(document({
    title: "", slug: "", category: "", date: "", content: createEmptyDocument(),
  }));
  const post = toArticlePost(draft);
  assert.equal(draft.readingMinutes, 0);
  assert.equal(post.title, "제목 없는 글");
  assert.equal(post.date, "2026-11-14");
  assert.equal(post.readingMinutes, 1);
});

test("한글 제목에서 경로 구분자 없는 글 주소를 만든다", () => {
  assert.equal(slugifyTitle("  React 렌더링을 이해하면!  "), "react-렌더링을-이해하면");
  assert.throws(() => parseBlogDocument(document({ slug: "../../README" })));
  assert.throws(() => parseBlogDocument(document({ id: "../other" })));
});

test("주소의 대소문자와 Unicode를 통일하고 파일 이름 길이를 제한한다", () => {
  assert.equal(parseBlogDocument(document({ slug: "ＦＩＲＳＴ-POST" })).slug, "first-post");
  assert.equal(parseBlogDocument(document({ slug: "한글".normalize("NFD") })).slug, "한글");
  const slug = slugifyTitle("가".repeat(100));
  assert(new TextEncoder().encode(slug).length <= 180);
  assert.throws(() => parseBlogDocument(document({ slug: "가".repeat(61) })));
});

test("발행하려면 제목과 글 주소 및 본문이 필요하다", () => {
  assert.throws(() => parseBlogDocument(document({ title: "" }), { publish: true }));
  assert.throws(() => parseBlogDocument(document({ slug: "" }), { publish: true }));
  assert.throws(() => parseBlogDocument(document({ content: createEmptyDocument() }), { publish: true }));
  assert.equal(parseBlogDocument(document(), { publish: true }).title, "첫 번째 글");
});

test("잘못된 날짜와 자동 읽기 시간의 유효하지 않은 값을 거부한다", () => {
  assert.throws(() => parseBlogDocument(document({ date: "2026-02-30" })));
  assert.throws(() => parseBlogDocument(document({ readingMinutes: -1 })));
  assert.throws(() => parseBlogDocument(document({ readingMinutes: 1.5 })));
  assert.throws(() => parseBlogDocument(document({ updatedAt: "unknown" })));
});

test("자동 읽기 시간과 직접 입력한 읽기 시간을 각각 반영한다", () => {
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "가".repeat(501) }] }] };
  assert.equal(estimateReadingMinutes(content), 2);
  assert.equal(parseBlogDocument(document({ content }), { publish: true }).readingMinutes, 2);
  assert.equal(parseBlogDocument(document({ content, readingMinutes: 8 }), { publish: true }).readingMinutes, 8);
});

test("링크에 실행 코드와 프로토콜 생략 및 자격 증명을 허용하지 않는다", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "//other.test", "https://name:secret@example.com", "/\\other.test"]) {
    assert.equal(isSafeContentUrl(url), false, url);
  }
  for (const url of ["https://example.com", "mailto:hello@example.com", "/posts/first-post/", "#section"]) {
    assert.equal(isSafeContentUrl(url), true, url);
  }
  const unsafe = document({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] } });
  assert.throws(() => parseBlogDocument(unsafe));
});

test("본문에 지원하지 않는 HTML 요소와 중첩 문서를 허용하지 않는다", () => {
  for (const node of [{ type: "iframe" }, { type: "doc", content: [] }, { type: "heading", attrs: { level: 1 } }]) {
    assert.throws(() => parseBlogDocument(document({ content: { type: "doc", content: [node] } })));
  }
});

test("업로드 중인 이미지는 미리 볼 수 있지만 공개 경로로 바뀌기 전에는 발행하지 않는다", () => {
  const image = { src: "/__editor/api/media/d8f87121-2345-4abc-8abc-123456789abc", alt: "화면 구성", width: 800, height: 600 };
  assert.equal(parseBlogDocument(document({ heroImage: image })).heroImage.src, image.src);
  assert.throws(() => parseBlogDocument(document({ heroImage: image }), { publish: true }));
  const published = parseBlogDocument(document({ heroImage: { ...image, src: "/uploads/example.png" } }), { publish: true });
  assert.equal(published.heroImage.width, 800);
  assert.throws(() => parseBlogDocument(document({ heroImage: { ...image, src: "/uploads/example.png", alt: "" } }), { publish: true }));
});

test("본문 이미지의 위험한 주소와 이미지가 아닌 프로토콜을 거부한다", () => {
  for (const src of ["javascript:alert(1)", "data:image/png;base64,aaa", "mailto:hello@example.com", "#image"]) {
    const content = { type: "doc", content: [{ type: "image", attrs: { src, alt: "이미지" } }] };
    assert.throws(() => parseBlogDocument(document({ content })));
  }
});

test("기기 내부의 절대 이미지 주소를 공개 글에 남기지 않는다", () => {
  for (const src of ["http://localhost:3000/uploads/image.png", "http://127.0.0.1:4319/media/image", "http://[::1]/image.png"]) {
    const content = { type: "doc", content: [{ type: "image", attrs: { src, alt: "이미지" } }] };
    assert.doesNotThrow(() => parseBlogDocument(document({ content })));
    assert.throws(() => parseBlogDocument(document({ content }), { publish: true }));
  }
});

test("본문의 임의 HTML 속성을 저장하지 않고 허용한 서식만 유지한다", () => {
  const content = { type: "doc", content: [{ type: "heading", attrs: { level: 2, onclick: "alert(1)", style: "color:red" }, content: [{ type: "text", text: "제목", marks: [{ type: "bold" }] }] }] };
  const result = parseBlogDocument(document({ content }));
  assert.deepEqual(result.content.content[0].attrs, { level: 2 });
  assert.deepEqual(result.content.content[0].content[0].marks, [{ type: "bold" }]);
});

test("지나치게 깊은 본문을 거부한다", () => {
  let content = { type: "paragraph" };
  for (let index = 0; index < 22; index += 1) content = { type: "blockquote", content: [content] };
  assert.throws(() => parseBlogDocument(document({ content: { type: "doc", content: [content] } })));
});

test("실제 편집기 문서에서 서식과 이미지 크기 및 코드를 저장할 수 있다", () => {
  const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3] } }), Image]);
  const content = schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "소제목" }] },
      { type: "paragraph", content: [{ type: "text", text: "중요한 내용", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }] }] },
      { type: "image", attrs: { src: "/uploads/example.png", alt: "렌더링 과정", width: 800, height: 600 } },
      { type: "codeBlock", attrs: { language: "tsx" }, content: [{ type: "text", text: "const count = 1;\n" }] },
    ],
  }).toJSON();
  const result = parseBlogDocument(document({ content }), { publish: true });
  assert.equal(result.content.content[0].attrs.level, 2);
  assert.equal(result.content.content[1].content[0].marks.find((mark) => mark.type === "link").attrs.href, "https://example.com");
  assert.equal(result.content.content[2].attrs.width, 800);
  assert.equal(result.content.content[2].attrs.height, 600);
  assert.equal(result.content.content[3].content[0].text, "const count = 1;\n");
});
