import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Dataset, Product, Run } from "../lib/schema";
// Separate database and local fake provider: these tests never call real platforms or consume a user key.
process.env.DB_PATH = resolve(
  mkdtempSync("data/workflow-test-"),
  "test.sqlite",
);
process.env.MODEL_API_KEY = "synthetic-test-key";
process.env.MODEL_NAME = "test-only";
process.env.MODEL_MAX_CALLS = "100";
let behavior: "ok" | "fail" | "invalid" | "slow" = "ok";
const stages: string[] = [];
const dataset = JSON.parse(
  readFileSync("samples/demo.json", "utf8"),
) as Dataset;
const product: Product = {
  id: "current",
  version: 1,
  name: "测试收纳盒",
  category: "收纳",
  price: "29元",
  specs: "20cm",
  sellingPoints: ["可叠放"],
  limits: "承重未知",
  budget: "未知",
  images: [],
};
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const system = body.messages[0].content as string;
  stages.push(system);
  const input = JSON.parse(body.messages[1].content);
  if (behavior === "slow") await new Promise((r) => setTimeout(r, 250));
  if (behavior === "fail") {
    res.writeHead(503);
    res.end("{}");
    return;
  }
  let data: unknown;
  if (behavior === "invalid") data = { nonsense: true };
  else if (system.includes("证据与事实一致性复核"))
    data = {
      topicIds: ["t1"],
      creatorIds: ["cr1"],
      demandIds: ["d1"],
      allowNotRecommended: false,
      issues: [],
    };
  else if (system.includes("仅重写标题"))
    data = [
      {
        id: "t1",
        title: "调整表达后的标题",
        angle: "更简洁的展示",
        steps: ["整理前", "叠放", "整理后"],
      },
    ];
  else if (system.includes("只根据新预算"))
    data = [
      {
        creatorId: "sample-only-author",
        status: "信息不足",
        reason: "预算已更新但报价未知",
        mismatch: "缺少合作条件",
        unknowns: ["报价未知"],
        questions: ["请核实报价"],
      },
    ];
  else if (system.includes("场景相关性") && !system.includes("需求聚合"))
    data = input.notes.map((n: { id: string }) => ({
      noteId: n.id,
      status: n.id === "sample:n:2" ? "irrelevant" : "direct",
      reason: "合成测试判断",
    }));
  else if (system.includes("评论多标签与目标对象"))
    data = input.comments.map((c: { id: string }) => ({
      commentId: c.id,
      target: c.id === "sample:c:3" ? "product" : "unknown",
      tags: [c.id === "sample:c:3" ? "购买顾虑" : "无法判断"],
    }));
  else
    data = {
      relevance: [],
      labels: [],
      demands: [
        {
          id: "d1",
          scene: "小书桌",
          problem: "空间小",
          concern: "尺寸",
          canMeet: "unknown",
          unknowns: ["适配尺寸"],
          evidenceIds: ["sample:c:3"],
        },
      ],
      topics: [
        {
          id: "t1",
          name: "小书桌",
          audience: "小桌用户",
          scene: "书桌",
          buyingReason: "整理空间",
          match: "可叠放",
          limitations: "承重未知",
          title: "叠放整理桌面",
          angle: "实物展示",
          steps: ["整理前", "叠放", "整理后"],
          evidenceIds: ["sample:n:1", "sample:c:3"],
          factIndices: [0],
          unknowns: ["适配尺寸"],
        },
      ],
      creators: [
        {
          id: "cr1",
          creatorId: "sample-only-author",
          reason: "书桌场景",
          mismatch: "作品不足",
          evidenceIds: ["sample:n:1"],
          unknowns: ["报价未知"],
          questions: ["报价"],
          status: "适合进一步了解",
        },
      ],
      reasons: { topics: "合成样例只有一个场景", creators: "合成作者不足" },
      notRecommended: null,
    };
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ data }) } }],
      usage: { total_tokens: 20 },
    }),
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string") throw Error("mock bind failed");
process.env.MODEL_BASE_URL = `http://127.0.0.1:${address.port}`;
const { get, saveRun } = await import("../lib/db");
const { createRun, launch } = await import("../lib/engine");
const { markdown } = await import("../lib/export");
after(() => server.close());
async function wait(id: string) {
  for (let i = 0; i < 200; i++) {
    const r = get<Run>("run", id)!;
    if (["failed", "cancelled", "complete"].includes(r.status)) return r;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("workflow did not finish");
}
test(
  "持久化、模型失败、JSON失败、重试和有效导出",
  { concurrency: false },
  async () => {
    behavior = "fail";
    const initial = createRun(
      product,
      ["桌面收纳"],
      structuredClone(dataset),
      1,
    );
    let r = await wait(initial.id);
    assert.equal(r.status, "failed");
    assert.equal(r.dataset.comments.length, 3);
    assert.equal(r.result, null);
    assert.ok(!markdown(r).includes("## 选题建议"));
    behavior = "invalid";
    launch(r.id, true);
    r = await wait(r.id);
    assert.equal(r.status, "failed");
    assert.ok(r.errors.some((e) => e.includes("结构校验")));
    behavior = "ok";
    launch(r.id, true);
    r = await wait(r.id);
    assert.equal(r.status, "complete");
    assert.equal(r.result?.topics.length, 1);
    assert.equal(r.result?.creators[0].status, "信息不足");
    assert.equal(r.result?.demands[0].userCount, null);
    assert.equal(r.history.length, 1);
    assert.ok(markdown(r).includes("## 选题建议"));
    assert.ok(!markdown(r).includes("synthetic-test-key"));
    assert.ok(r.usage.length > 0);
    const count = stages.length;
    r.product = { ...product, version: 2, budget: "500元" };
    r.result = null;
    saveRun(r);
    launch(r.id, true, "budget");
    r = await wait(r.id);
    assert.equal(r.status, "complete");
    assert.equal(r.result?.productVersion, 2);
    assert.equal(r.history[0].productVersion, 1);
    assert.equal(r.result?.topics[0].title, "叠放整理桌面");
    assert.ok(
      stages
        .slice(count)
        .every(
          (s) =>
            !s.includes("当前阶段：场景相关性") &&
            !s.includes("当前阶段：评论多标签"),
        ),
    );
    r.corrections.push({ kind: "preference", text: "标题简洁一点" });
    r.result = null;
    saveRun(r);
    launch(r.id, true, "preference");
    r = await wait(r.id);
    assert.equal(r.result?.topics[0].title, "调整表达后的标题");
    assert.equal(r.result?.topics[0].scene, "书桌");
    assert.deepEqual(r.result?.topics[0].evidenceIds, [
      "sample:n:1",
      "sample:c:3",
    ]);
    r.corrections.push({
      kind: "comment-target",
      id: "sample:c:3",
      target: "other",
    });
    r.result = null;
    saveRun(r);
    launch(r.id, true);
    r = await wait(r.id);
    assert.equal(r.result?.topics.length, 0);
    assert.equal(r.result?.demands.length, 0);
    assert.equal(r.history.length, 4);
  },
);
test(
  "取消不被异步模型用量保存覆盖，重试后完成",
  { concurrency: false },
  async () => {
    behavior = "slow";
    const initial = createRun(
      product,
      ["桌面收纳"],
      structuredClone(dataset),
      1,
    );
    await new Promise((r) => setTimeout(r, 50));
    const current = get<Run>("run", initial.id)!;
    current.cancelRequested = true;
    saveRun(current);
    let r = await wait(initial.id);
    assert.equal(r.status, "cancelled");
    assert.equal(r.dataset.notes.length, 2);
    assert.equal(r.result, null);
    behavior = "ok";
    r.cancelRequested = false;
    saveRun(r);
    launch(r.id, true);
    r = await wait(r.id);
    assert.equal(r.status, "complete");
  },
);
