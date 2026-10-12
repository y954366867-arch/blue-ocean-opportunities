import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
process.env.DB_PATH = resolve(
  mkdtempSync("./data/v3-workflow-"),
  "test.sqlite",
);
const { startCategory, cancelCategory, publicCategory } =
  await import("../lib/category");
const { get } = await import("../lib/db");
test("V3有限采集契约、模型证据、缓存复用、取消与总预算", async () => {
  let calls = 0,
    delayed = false;
  const notes = [1, 2, 3, 4].map((i) => ({
    id: "test-" + i,
    xsecToken: "private-access",
    noteCard: {
      type: "video",
      title: "通勤包包分享 " + i,
      desc: "包包分享日常使用主题 " + i,
      time: Date.now() - 86400000,
      user: { userId: "author-" + i },
      interactInfo: {
        likedCount: i === 1 ? "9000" : "1200",
        collectedCount: i === 2 ? "8000" : "50",
        commentCount: i === 3 ? "900" : "5",
      },
    },
  }));
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const b = JSON.parse(raw || "{}");
    calls++;
    if (delayed) await new Promise((r) => setTimeout(r, 100));
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/feeds/search") {
      assert.equal(b.filters.note_type, "视频");
      res.end(JSON.stringify({ success: true, data: { feeds: notes } }));
    } else if (req.url === "/api/v1/feeds/detail") {
      assert.equal(b.load_all_comments, false);
      res.end(
        JSON.stringify({
          success: true,
          data: {
            data: {
              note: {
                ...notes.find((n) => n.id === b.feed_id)!.noteCard,
                noteId: b.feed_id,
              },
            },
          },
        }),
      );
    } else if (req.url === "/chat/completions")
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  data: {
                    directions: [
                      {
                        name: "通勤分享",
                        topic: "日常装包",
                        concern: "文案关注使用",
                        pattern: "使用分享",
                        reason: "明确包包文字",
                        evidence: [1, 2, 3].map((i) => ({
                          noteId: "xhs:n:test-" + i,
                          quote: "包包分享日常使用主题",
                        })),
                        opening: "AI建议",
                        shots: ["展示包", "装包", "总结"],
                      },
                    ],
                  },
                }),
              },
            },
          ],
          usage: { total_tokens: 100 },
        }),
      );
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as any;
  process.env.XHS_BASE_URL = process.env.MODEL_BASE_URL =
    "http://127.0.0.1:" + address.port;
  process.env.MODEL_NAME = "test";
  process.env.MODEL_API_KEY = "test";
  async function wait(id: string) {
    for (let i = 0; i < 200; i++) {
      const r = get<any>("category-run", id);
      if (r.status !== "running") return r;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("任务未结束");
  }
  try {
    const first = startCategory({ categoryId: "bags" }, true);
    assert.equal(startCategory({ categoryId: "bags" }, true).id, first.id);
    const done = await wait(first.id);
    assert.equal(done.status, "complete");
    assert.equal(done.directions[0].status, "confirmed");
    assert.equal(done.hotIds.length, 3);
    const before = calls;
    assert.equal(startCategory({ categoryId: "bags" }).id, done.id);
    assert.equal(calls, before);
    assert.doesNotMatch(JSON.stringify(publicCategory(done)), /private-access/);
    delayed = true;
    const next = startCategory({ categoryId: "bags" }, true);
    cancelCategory(next.id);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(get<any>("category-run", next.id).status, "cancelled");
    assert.equal(get<any>("category-run", next.id).cancelRequested, true);
    process.env.CATEGORY_BUDGET_MS = "20";
    const timeout = startCategory({ categoryId: "bags" }, true);
    const partial = await wait(timeout.id);
    assert.equal(partial.status, "partial");
    assert.match(partial.warnings.join(""), /时间预算/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
