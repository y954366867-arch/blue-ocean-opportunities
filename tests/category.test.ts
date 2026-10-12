import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNote } from "../lib/collector";
import {
  Selection,
  related,
  validVideo,
  selectHeat,
  validateDirections,
} from "../lib/category";
const selection = Selection.parse({ categoryId: "bags" });
function note(
  id: string,
  author = id,
  title = "通勤包包容量展示",
  likes = "2000",
) {
  return normalizeNote({
    id,
    noteCard: {
      type: "video",
      title,
      desc: "通勤包包容量展示，分享日常收纳主题。" + id,
      time: Date.now() - 86400000,
      user: { userId: author },
      interactInfo: {
        likedCount: likes,
        collectedCount: "400",
        commentCount: "10",
      },
    },
  });
}
test("类型必须来自上游，日期缺失/过期/未来不能冒充近30天视频", () => {
  const n = note("a");
  assert.equal(validVideo(n, selection), true);
  for (const variant of [
    { ...n, contentType: "unknown" as const },
    { ...n, contentType: "image" as const },
    { ...n, publishedAt: null },
    { ...n, publishedAt: new Date(Date.now() - 40 * 86400000).toISOString() },
    { ...n, publishedAt: new Date(Date.now() + 86400000).toISOString() },
  ])
    assert.equal(validVideo(variant, selection), false);
  assert.equal(
    normalizeNote({ id: "x", noteCard: { title: "视频包包" } }).contentType,
    "unknown",
  );
});
test("热度不能抵消类目不相关，细筛必须有文字依据", () => {
  assert.equal(
    related(
      { ...note("x", "a", "情感话题", "100000"), text: "恋爱情感分享" },
      selection,
    ),
    null,
  );
  assert.equal(related(note("x"), { ...selection, style: "韩式" }), null);
  assert.equal(
    related(note("x"), { ...selection, subcategory: "通勤包" }),
    "包包",
  );
});
test("低互动样本第一名不算高热；三个指标分别比较，保留近似下界", () => {
  assert.deepEqual(
    selectHeat(
      [note("low", "a", "包包", "10")].map((n) => ({
        ...n,
        metricsRaw: { likes: "10", favorites: "2", comments: "0" },
      })),
    ),
    {},
  );
  const n = note("high", "a", "包包", "1万+");
  assert.match(selectHeat([n])[n.id].join(""), /下界/);
});
test("方向证据须是真实摘录，三视频两作者才正式，同源复制去重", () => {
  const notes = [note("a", "one"), note("b", "one"), note("c", "two")];
  const card = {
    name: "通勤容量",
    topic: "容量",
    concern: "装什么",
    pattern: "装包主题",
    reason: "明确提及包",
    opening: "AI建议",
    shots: ["展示包", "装入物品", "总结"],
    evidence: notes.map((n) => ({ noteId: n.id, quote: "通勤包包容量展示" })),
  };
  assert.equal(
    validateDirections(
      { directions: [card] },
      notes,
      notes.map((n) => n.id),
    )[0].status,
    "confirmed",
  );
  assert.equal(
    validateDirections(
      { directions: [card] },
      notes.slice(0, 2),
      notes.map((n) => n.id),
    )[0].status,
    "provisional",
  );
  assert.deepEqual(
    validateDirections(
      {
        directions: [
          { ...card, evidence: [{ noteId: "fake", quote: "编造证据" }] },
        ],
      },
      notes,
      notes.map((n) => n.id),
    ),
    [],
  );
  const copies = notes.map((n) => ({
    ...n,
    title: notes[0].title,
    text: notes[0].text,
  }));
  assert.equal(
    validateDirections(
      { directions: [card] },
      copies,
      copies.map((n) => n.id),
    )[0].noteIds.length,
    1,
  );
});
