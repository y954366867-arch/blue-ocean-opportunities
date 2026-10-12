import { test } from "node:test";
import assert from "node:assert/strict";
import { Selection, refresh, verificationCandidates, type CategoryRun } from "../lib/category-v4";
test("默认60天：45天前合格低粉视频保留，61天前排除", () => {
  const s = Selection.parse({ categoryId: "bags" });
  assert.equal(s.days, 60);
  const n = (days: number) =>
    ({
      id: "day:" + days,
      title: "通勤包包分享",
      text: "日常通勤包包分享",
      creatorId: "u" + days,
      contentType: "video",
      publishedAt: new Date(Date.now() - days * 86400000).toISOString(),
      metrics: { likes: 100, comments: 0, favorites: 0 },
      images: [],
      queries: [],
    }) as any;
  const notes = [n(45), n(61)];
  const r = {
    selection: s,
    notes,
    classifications: notes.map((n) => ({
      noteId: n.id,
      relevant: true,
      status: "verified-text",
      quote: "通勤包包",
      reason: "通勤包商品",
      labels: [],
    })),
    followers: Object.fromEntries(
      notes.map((n) => [
        n.creatorId,
        { creatorId: n.creatorId, raw: "203", value: 203, status: "verified" },
      ]),
    ),
    commentReviews: [],
    directions: [],
    searches: [],
  } as unknown as CategoryRun;
  refresh(r);
  assert.deepEqual(r.qualifiedIds, ["day:45"]);
});

test("优先补齐已知低粉候选详情，核实失败有限重试", () => {
  const notes = [
    { id: "unknown", creatorId: "a" },
    { id: "low", creatorId: "b" },
  ] as any;
  const r = {
    selection: Selection.parse({ categoryId: "bags" }),
    followers: { b: { raw: "203", value: 203, status: "verified" } },
    deepIds: [],
    attemptedDeepIds: [],
    verificationAttempts: { low: 2 },
  } as any;
  assert.equal(verificationCandidates(r, notes)[0].id, "low");
  r.attemptedDeepIds = ["low", "low"];
  assert.deepEqual(
    verificationCandidates(r, notes).map((n) => n.id),
    ["unknown"],
  );
});

