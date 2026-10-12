import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import type { Run } from "../lib/schema";
process.env.DB_PATH = resolve(mkdtempSync("data/v2-test-"), "test.sqlite");
process.env.MODEL_API_KEY = "synthetic";
process.env.MODEL_NAME = "synthetic";
const { createRun } = await import("../lib/engine");
const { get, saveRun } = await import("../lib/db");
const { executeV2 } = await import("../lib/engine-v2");
const { normalizeNote } = await import("../lib/collector");
test("V2 no price, no selling points, no comments: style and hot body yields reference and real creator; conflict excluded", async () => {
  let fail = false;
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    if (fail) {
      res.writeHead(503);
      res.end("{}");
      return;
    }
    const body = JSON.parse(text),
      input = JSON.parse(body.messages[1].content);
    const data = input.cards
      ? {
          topics: input.cards,
          supports: input.cards.flatMap((t: any) =>
            t.evidenceIds.map((id: string) => ({
              topicId: t.id,
              noteId: id,
              quote: input.notes.find((n: any) => n.id === id).text,
              supportsPattern: true,
            })),
          ),
        }
      : body.messages[0].content.includes("matchedFeatures")
        ? input.notes.map((n: any) => ({
            noteId: n.id,
            status: n.title === "冲突痛包" ? "不适配" : "适配",
            reason: "文字韩系简约包型",
            matchedFeatures: ["韩系"],
            conflicts: n.title === "冲突痛包" ? ["痛包"] : [],
          }))
        : {
            topics: [
              {
                id: "t1",
                name: "韩系日常包展示",
                title: "韩系包包搭配",
                angle: "展示搭配",
                match: "正文明确韩系",
                commonPattern: "白墙构图",
                steps: ["摆放", "搭配", "展示"],
                evidenceIds: ["xhs:n:hot"],
                unknowns: ["配色待确认"],
              },
            ],
          };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ data }) } }],
        usage: { total_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.MODEL_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const notes = [
      normalizeNote({
        id: "hot",
        note: {
          title: "韩式包包",
          desc: "韩系包包简约日常搭配",
          user: { userId: "actual", nickname: "原始作者" },
          interactInfo: { likedCount: "1万+" },
        },
      }),
      normalizeNote({
        id: "conflict",
        note: {
          title: "冲突痛包",
          desc: "痛包装饰",
          user: { userId: "wrong" },
          interactInfo: { likedCount: "100000" },
        },
      }),
    ];
    const r = createRun(
      {
        id: "x",
        version: 1,
        name: "韩式包包",
        category: "包",
        price: "",
        specs: "",
        sellingPoints: [],
        limits: "",
        budget: "",
        images: [],
      },
      ["韩式包包"],
      {
        provenance: {
          source: "sample",
          collectedAt: new Date().toISOString(),
          coverage: "synthetic",
        },
        notes,
        comments: [],
      },
    );
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (!["queued", "running"].includes(get<Run>("run", r.id)!.status)) break;
    }
    const done = get<Run>("run", r.id)!;
    assert.equal(done.status, "complete");
    assert.equal(done.v2!.topics[0].kind, "高热参考");
    assert.equal(done.v2!.creators[0].id, "actual");
    assert.equal(done.v2!.creators[0].status, "有高热相关作品的候选");
    assert.ok(!done.v2!.hotIds.includes("xhs:n:conflict"));
    assert.equal(done.dataset.comments.length, 0);
    fail = true;
    await executeV2(done.id, true);
    const partial = get<Run>("run", done.id)!;
    assert.equal(partial.status, "failed");
    assert.equal(partial.v2!.topics[0].id, done.v2!.topics[0].id);
    assert.ok(partial.stage.includes("部分结果"));
    fail = false;
    process.env.RESEARCH_BUDGET_MS = "1";
    partial.cancelRequested = false;
    saveRun(partial);
    const timed = Date.now();
    await executeV2(partial.id, true);
    assert.ok(Date.now() - timed < 1000);
    assert.equal(
      get<Run>("run", done.id)!.v2!.topics[0].id,
      done.v2!.topics[0].id,
    );
    delete process.env.RESEARCH_BUDGET_MS;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
