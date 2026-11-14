import { test } from "node:test";
import assert from "node:assert/strict";

import { getGitHubTooltipPosition } from "../app/(routes)/(public)/_lib/github-tooltip.ts";

const size = { width: 180, height: 32 };
const viewport = { width: 800, height: 600 };

test("보이는 칸 위에 말풍선을 배치하고 화살표를 칸 중앙에 맞춘다", () => {
  const position = getGitHubTooltipPosition({ left: 300, right: 312, top: 200, bottom: 212 }, size, viewport);
  assert.deepEqual(position, { left: 306, top: 192, arrowLeft: 90, placement: "top" });
});

test("양 끝 날짜에서도 말풍선을 화면 안에 두고 화살표 위치를 보정한다", () => {
  const left = getGitHubTooltipPosition({ left: 0, right: 12, top: 200, bottom: 212 }, size, viewport);
  const right = getGitHubTooltipPosition({ left: 788, right: 800, top: 200, bottom: 212 }, size, viewport);
  assert.equal(left.left - size.width / 2, 8);
  assert.equal(right.left + size.width / 2, viewport.width - 8);
  assert(left.arrowLeft >= 8 && left.arrowLeft <= size.width - 8);
  assert(right.arrowLeft >= 8 && right.arrowLeft <= size.width - 8);
  assert(left.arrowLeft < size.width / 2);
  assert(right.arrowLeft > size.width / 2);
});

test("상단 공간이 없으면 칸 아래로 뒤집어 내용이 잘리지 않게 한다", () => {
  const position = getGitHubTooltipPosition({ left: 300, right: 312, top: 10, bottom: 22 }, size, viewport);
  assert.equal(position.placement, "bottom");
  assert.equal(position.top, 30);
  assert(position.top + size.height <= viewport.height - 8);
});

test("좁고 낮은 화면에서도 확보 가능한 공간에 말풍선을 배치한다", () => {
  const screen = { width: 240, height: 60 };
  for (const top of [0, 20, 45]) {
    const position = getGitHubTooltipPosition({ left: 220, right: 232, top, bottom: top + 12 }, size, screen);
    const boxTop = position.placement === "top" ? position.top - size.height : position.top;
    assert(position.left - size.width / 2 >= 8);
    assert(position.left + size.width / 2 <= screen.width - 8);
    assert(boxTop >= 8);
    assert(boxTop + size.height <= screen.height - 8);
  }
});
