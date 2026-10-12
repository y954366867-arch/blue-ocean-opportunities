import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeNote, normalizeComments } from "../lib/collector";
import {
  Selection,
  candidate,
  heat,
  normalizeFollowers,
  lowFollower,
  followerBounds,
  validateDiscovery,
  reviewComments,
  diverse,
  refresh,
} from "../lib/category-v4";
const s = Selection.parse({ categoryId: "bags" });
function n(id: string, likes = "100", comments = "20", creator = id) {
  return normalizeNote(
    {
      id,
      noteCard: {
        type: "video",
        title: "装包分享 " + id,
        desc: "分享通勤装包，复古托特包",
        time: Date.now() - 86400000,
        user: { userId: creator },
        interactInfo: {
          likedCount: likes,
          commentCount: comments,
          collectedCount: "20",
        },
      },
    },
    "包",
  );
}
test("V4 候选条件为点赞或评论，单条不附加小样本硬门槛", () => {
  assert.equal(candidate(n("a"), s), true);
  assert.equal(candidate(n("b", "99"), s), true);
  assert.equal(candidate(n("c", "100", "19"), s), true);
  assert.equal(candidate(n("below", "99", "19"), s), false);
  assert.equal(candidate(n("unknown", "未知", "20"), s), true);
  assert.equal(Object.keys(heat([n("a"), n("b"), n("c")], s)).length, 3);
  assert.ok(heat([n("x", "2000", "100")], s)["xhs:n:x"]);
});
test("真实203粉、773赞、38评论缓存成为单条内容灵感，仍排除未知/大号/日期/类型/无关项", () => {
  const r = JSON.parse(readFileSync("reports/v4-final.json", "utf8")).run;
  const target = r.notes.find((n: any) => n.followers?.raw === "203");
  assert.ok(target);
  assert.equal(target.metricsRaw.likes, "773");
  assert.equal(target.metricsRaw.comments, "38");
  refresh(r);
  assert.ok(r.qualifiedIds.includes(target.id));
  assert.ok(
    r.directions.some(
      (d: any) => d.noteIds.includes(target.id) && d.status === "provisional",
    ),
  );
  for (const patch of [
    { publishedAt: null },
    { publishedAt: new Date(Date.now() - 40 * 86400000).toISOString() },
    { contentType: "image" },
    { contentType: "unknown" },
  ]) {
    const copy = structuredClone(r);
    Object.assign(
      copy.notes.find((n: any) => n.id === target.id),
      patch,
    );
    refresh(copy);
    assert.ok(!copy.qualifiedIds.includes(target.id));
  }
  for (const raw of [null, "10001", "1万"]) {
    const copy = structuredClone(r);
    copy.followers[target.creatorId] = normalizeFollowers(
      { interactions: [{ type: "fans", count: raw }] },
      target.creatorId,
    );
    refresh(copy);
    assert.ok(!copy.qualifiedIds.includes(target.id));
  }
  const unrelated = structuredClone(r);
  unrelated.classifications.find((c: any) => c.noteId === target.id).relevant =
    false;
  refresh(unrelated);
  assert.ok(!unrelated.qualifiedIds.includes(target.id));
});
test("粉丝未知、模糊跨线、下界值不能冒充低粉", () => {
  const f = (raw: any) =>
    normalizeFollowers({ interactions: [{ type: "fans", count: raw }] }, "a");
  assert.equal(lowFollower(f(null), 10000), false);
  assert.equal(lowFollower(f("1万"), 10000), false);
  assert.equal(lowFollower(f("1万+"), 10000), false);
  assert.equal(lowFollower(f("9999"), 10000), true);
  assert.equal(lowFollower(f("5000"), 1000), false);
  assert.equal(lowFollower(f("1.1万"), 10000), false);
  assert.equal(followerBounds("0.9万").upper, 9500);
});
test("扩搜必须有真实相关出处，原文词与概括区分", () => {
  const a = n("a");
  const result = validateDiscovery(
    {
      classifications: [
        {
          noteId: a.id,
          relevant: true,
          quote: "装包分享",
          reason: "包型分享",
          labels: [
            { value: "复古", type: "style", quote: "复古托特包" },
            { value: "韩系", type: "style", quote: "不存在" },
          ],
        },
      ],
      queries: [
        {
          query: "装包分享",
          labelType: "format",
          sourceQuotes: [{ noteId: a.id, quote: "装包分享" }],
          selectionReason: "原文",
          originalPhrase: true,
        },
        {
          query: "韩系开箱",
          labelType: "style",
          sourceQuotes: [{ noteId: a.id, quote: "不存在" }],
          selectionReason: "无证据",
          originalPhrase: false,
        },
      ],
    },
    [a],
    1,
  );
  assert.equal(result.queries.length, 1);
  assert.equal(result.queries[0].status, "original-phrase");
  assert.equal(result.classifications[0].labels.length, 1);
});
test("红包与包装的语义排除结果不得生成扩搜证据", () => {
  const a = { ...n("a"), title: "红包包装", text: "红包包装教程" };
  assert.equal(
    validateDiscovery(
      {
        classifications: [
          {
            noteId: a.id,
            relevant: false,
            quote: "红包包装",
            reason: "无关",
            labels: [],
          },
        ],
        queries: [
          {
            query: "红包包装",
            labelType: "format",
            sourceQuotes: [{ noteId: a.id, quote: "红包包装" }],
            selectionReason: "无关",
            originalPhrase: true,
          },
        ],
      },
      [a],
      1,
    ).queries.length,
    0,
  );
});
test("抽奖样本排除且同一评论不重复计入不同类型", () => {
  const a = n("a");
  const items = normalizeComments(
    Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      content: "抽奖送包",
      userInfo: { userId: "u" + i },
    })),
    a.id,
  );
  const labels = items.flatMap((c) => [
    { commentId: c.id, kind: "lottery" as const, quote: "抽奖" },
    { commentId: c.id, kind: "related" as const, quote: "送包" },
  ]);
  const r = reviewComments(a, items, { labels }, true);
  assert.equal(r.status, "unsuitable");
  assert.equal(r.relatedCount, 0);
  assert.equal(r.lotteryCount, 6);
});
test("入口与不同作者分层留样", () => {
  const many = [
    n("a", "1000", "400", "same"),
    n("b", "900", "300", "same"),
    { ...n("c", "800", "200", "other"), queries: ["包包"] },
  ];
  const chosen = diverse(many, 2);
  assert.equal(new Set(chosen.map((n) => n.creatorId)).size, 2);
});
