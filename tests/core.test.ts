import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCorrections,
  shortlist,
  validateAnalysis,
} from "../lib/validation";
import { parseImport } from "../lib/import";
import { metric, normalizeComments } from "../lib/collector";
import { publicDataset } from "../lib/public";
import type { Analysis, Dataset, Product } from "../lib/schema";
const product: Product = {
  id: "p",
  version: 2,
  name: "收纳盒",
  category: "收纳",
  price: "29",
  specs: "20cm",
  sellingPoints: ["可叠放"],
  limits: "承重未知",
  budget: "未知",
  images: [],
};
const data: Dataset = {
  provenance: {
    source: "sample",
    collectedAt: "2026-10-10T12:00:00.000Z",
    coverage: "纯合成测试",
  },
  notes: [
    {
      id: "n1",
      platformId: "1",
      creatorId: "u1",
      creatorName: "合成作者",
      title: "收纳",
      text: "书桌整理",
      publishedAt: null,
      metrics: { likes: 10, favorites: 2, comments: 2 },
      images: [],
      queries: [],
      ref: { xsecToken: "secret" },
      kind: "candidate",
    },
    {
      id: "n2",
      platformId: "2",
      creatorId: "u2",
      creatorName: "无关作者",
      title: "美食",
      text: "面条",
      publishedAt: null,
      metrics: { likes: 10000, favorites: 999, comments: 900 },
      images: [],
      queries: [],
      kind: "candidate",
    },
  ],
  comments: [
    {
      id: "c1",
      platformId: "c",
      noteId: "n1",
      parentId: null,
      userId: "u3",
      text: "求链接（笔记里有多个商品）",
      target: null,
    },
  ],
};
const topic = {
  id: "t",
  name: "书桌",
  audience: "学生",
  scene: "书桌",
  buyingReason: "整理",
  match: "可叠放",
  limitations: "承重未知",
  title: "整理书桌",
  angle: "整理",
  steps: ["前", "中", "后"],
  evidenceIds: ["c1"],
  factIndices: [0],
  unknowns: ["承重"],
};
const a: Analysis = {
  relevance: [
    { noteId: "n1", status: "direct", reason: "收纳" },
    { noteId: "n2", status: "irrelevant", reason: "美食" },
  ],
  labels: [{ commentId: "c1", target: "unknown", tags: ["无法判断"] }],
  demands: [],
  topics: [topic],
  creators: [
    {
      id: "cr",
      creatorId: "u1",
      reason: "收纳内容",
      mismatch: "证据少",
      evidenceIds: ["n1"],
      unknowns: [],
      questions: ["报价"],
      status: "适合进一步了解",
    },
  ],
  reasons: { topics: "证据不足", creators: "作品不足" },
  notRecommended: null,
};
test("多商品含糊求链接不能成为需求证据", () => {
  assert.equal(validateAnalysis(a, data, product, 1).topics.length, 0);
});
test("无关高热不能进入建议", () => {
  assert.equal(shortlist(data.notes).length, 2);
  assert.equal(
    validateAnalysis(
      { ...a, topics: [{ ...topic, evidenceIds: ["n2"] }] },
      data,
      product,
      1,
    ).topics.length,
    0,
  );
});
test("缺少近期多作品证据的达人降级，报价保持 null", () => {
  const r = validateAnalysis(a, data, product, 1);
  assert.equal(r.creators[0].status, "信息不足");
  assert.equal(r.creators[0].quote, null);
  assert.equal(r.productVersion, 2);
});
test("虚构证据、虚构作者、越界性能引用被移除", () => {
  const r = validateAnalysis(
    {
      ...a,
      topics: [
        { ...topic, evidenceIds: ["not-found"] },
        { ...topic, id: "bad", evidenceIds: ["n1"], factIndices: [10] },
      ],
      creators: [{ ...a.creators[0], creatorId: "fake" }],
    },
    data,
    product,
    1,
  );
  assert.equal(r.topics.length, 0);
  assert.equal(r.creators.length, 0);
});
test("排除笔记及评论目标纠正影响下游", () => {
  const d = applyCorrections(data, [{ kind: "exclude-note", id: "n1" }]);
  assert.equal(d.comments.length, 0);
  assert.equal(validateAnalysis(a, d, product, 1).creators.length, 0);
  const changed = applyCorrections(data, [
    { kind: "comment-target", id: "c1", target: "other" },
  ]);
  assert.equal(
    validateAnalysis(
      {
        ...a,
        labels: [{ commentId: "c1", target: "product", tags: ["商品兴趣"] }],
      },
      changed,
      product,
      1,
    ).topics.length,
    0,
  );
});
test("原始评论父子关系保留", () => {
  const cs = normalizeComments(
    [
      {
        id: "a",
        content: "父",
        userInfo: { userId: "u" },
        subComments: [{ id: "b", content: "子" }],
      },
    ],
    "n1",
  );
  assert.equal(cs[1].parentId, cs[0].id);
  assert.equal(cs[1].userId, null);
});
test("模糊互动量不伪装为精确数字，访问 token 不输出", () => {
  assert.equal(metric("1.2万"), null);
  assert.equal(metric("1,234"), 1234);
  assert.ok(!JSON.stringify(publicDataset(data)).includes("secret"));
});
test("导入保留样例来源与覆盖范围；拒绝悬空评论", () => {
  assert.equal(
    parseImport(JSON.stringify(data), "json").provenance.source,
    "sample",
  );
  assert.throws(() =>
    parseImport(JSON.stringify({ ...data, notes: [] }), "json"),
  );
});
