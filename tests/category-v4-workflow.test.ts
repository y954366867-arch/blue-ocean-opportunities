import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
process.env.DB_PATH = resolve(
  mkdtempSync("./data/v4-workflow-"),
  "test.sqlite",
);
const {
  startCategory,
  cancelCategory,
  publicCategory,
  latestCategory,
  filteredCategory,
  Selection,
} = await import("../lib/category-v4");
const { get, save } = await import("../lib/db");
test("V4 两轮搜索、作者去重、低粉核实、续采与取消契约", async () => {
  const queries: string[] = [];
  const profiles: string[] = [];
  let delay = false;
  const feeds = [1, 2, 3, 4, 5, 6].map((i) => ({
    id: "v4-" + i,
    xsecToken: "private-token",
    noteCard: {
      type: "video",
      title: "装包分享 " + i,
      desc: "复古托特包的装包分享 " + i,
      time: Date.now() - 86400000,
      user: { userId: "u" + (i === 6 ? 1 : i) },
      interactInfo: {
        likedCount: "2000",
        collectedCount: "400",
        commentCount: "100",
      },
    },
  }));
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const b = JSON.parse(raw || "{}");
    if (delay) await new Promise((r) => setTimeout(r, 100));
    let data: any = {};
    if (req.url === "/api/v1/feeds/search") {
      queries.push(b.keyword + "|" + b.filters.sort_by);
      data = {
        feeds:
          b.keyword === "包" || b.keyword === "包包"
            ? feeds.slice(0, 5)
            : feeds.slice(5),
      };
      assert.equal(b.filters.note_type, b.keyword === "包" || b.keyword === "包包" ? "不限" : "视频");
    } else if (req.url === "/api/v1/feeds/detail") {
      if (b.load_all_comments)
        data = {
          data: {
            note: {
              ...feeds.find((n) => n.id === b.feed_id)!.noteCard,
              noteId: b.feed_id,
            },
            comments: {
              list: Array.from({ length: 5 }, (_, i) => ({
                id: "c" + i,
                content: "这款包的容量很好",
                userInfo: { userId: "reader" + i },
              })),
              hasMore: false,
            },
          },
        };
      else
        data = {
          data: {
            note: {
              ...feeds.find((n) => n.id === b.feed_id)!.noteCard,
              noteId: b.feed_id,
            },
          },
        };
    } else if (req.url === "/api/v1/user/profile") {
      profiles.push(b.user_id);
      data = {
        interactions:
          b.user_id === "u5"
            ? []
            : [
                {
                  type: "fans",
                  count:
                    b.user_id === "u4"
                      ? "20000"
                      : b.user_id === "u3"
                        ? "1500"
                        : "888",
                },
              ],
      };
    } else if (req.url === "/chat/completions") {
      const input = JSON.parse(b.messages[1].content);
      let answer: any;
      if (input.instruction.includes("逐条判断"))
        answer = {
          labels: input.comments.map((c: any) => ({
            commentId: c.commentId,
            kind: "related",
            quote: "这款包的容量很好",
          })),
        };
      else if (input.draftGroups)
        answer = {comparisons:[]};
      else if (input.instruction.includes("所有品类长期规则"))
        answer = {
          groups: [
            {
              existingGroupId: input.existingGroups?.[0]?.id || null,
              theme: "通勤装包分享共同主题",
              commonPoint: "多条标题正文围绕通勤装包分享展开",
              associations: input.notes.map((n: any) => ({
                noteId: n.noteId,
                reason: "文字围绕通勤装包分享共同主题",
                quote: "装包分享",
              })),
            },
          ],
          pendingIds: [],
        };
      else if (input.instruction.includes("共同创作主题、场景"))
        answer = {
          items: input.notes.map((n: any) => ({
            noteId: n.noteId,
            relevant: true,
            quote: "装包分享",
            reason: "属于包类商品",
            facets: Object.fromEntries(
              ["productType", "theme", "scene", "audience", "format"].map(
                (k) => [
                  k,
                  {
                    value:
                      k === "productType"
                        ? "托特包"
                        : k === "theme"
                          ? "装包分享"
                          : null,
                    quote:
                      k === "productType"
                        ? "托特包"
                        : k === "theme"
                          ? "装包分享"
                          : "",
                  },
                ],
              ),
            ),
          })),
        };
      else if (input.instruction.includes("对创作有启发"))
        answer = {
          cards: [
            {
              theme: "通勤托特包装包清单",
              core: "基于通勤需求组织随身物品的选包参考",
    interactionObservation: null,
    angle: "从每天实际携带的物品切入容量主题",
              organization: [
                "先列出实际携带物品清单",
                "再按使用频率分组说明收纳",
              ],
              interactionAdvice: "邀请读者补充每天必带的一件物品",
              observations: input.notes.map((n: any) => ({
                noteId: n.noteId,
                quote: "装包分享",
                claim: "标题明确围绕装包分享主题",
              })),
              associations: input.notes.map((n: any) => ({
                noteId: n.noteId,
                quote: "装包分享",
                reason: "装包分享文字支持携带清单主题",
              })),
            },
          ],
        };
      else
        answer = {
          classifications: input.notes.map((n: any) => ({
            noteId: n.noteId,
            relevant: true,
            quote: "装包分享",
            reason: "相关",
            labels: [{ value: "复古", type: "style", quote: "复古托特包" }],
          })),
          queries: input.instruction.includes("可以输出")
            ? [
                {
                  query: "装包分享",
                  labelType: "format",
                  sourceQuotes: [
                    { noteId: input.notes[0].noteId, quote: "装包分享" },
                  ],
                  selectionReason: "实际主题",
                  originalPhrase: true,
                },
              ]
            : [],
        };
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ data: answer }) } }],
          usage: { total_tokens: 100 },
        }),
      );
      return;
    } else {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as any;
  process.env.XHS_BASE_URL = process.env.MODEL_BASE_URL =
    "http://127.0.0.1:" + a.port;
  process.env.MODEL_NAME = "test";
  process.env.MODEL_API_KEY = "test";
  async function wait(id: string) {
    for (let i = 0; i < 500; i++) {
      const r = get<any>("category-run", id)!;
      if (r.status !== "running") return r;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("未结束");
  }
  try {
    const first = startCategory({ categoryId: "bags" }, true);
    const done = await wait(first.id);
    assert.deepEqual(queries.slice(0, 3), [
      "包|综合",
      "包包|最新",
      "包包|最多评论",
    ]);
    assert.ok(queries.includes("装包分享|最新"));
    assert.equal(done.notes.length, 6);
    assert.equal(done.qualifiedIds.length, 4);
    assert.ok(!done.qualifiedIds.includes("xhs:n:v4-4"));
    assert.ok(!done.qualifiedIds.includes("xhs:n:v4-5"));
    assert.equal(profiles.filter((x) => x === "u1").length, 1);
    assert.equal(done.directions[0].status, "confirmed");
    assert.doesNotMatch(JSON.stringify(publicCategory(done)), /private-token/);
    assert.equal(
      latestCategory(Selection.parse({ categoryId: "bags" }))!.id,
      done.id,
    );
    process.env.CONTENT_CACHE_ONLY = "1";
    const beforeQueries = queries.length;
    const resumed = await wait(
      startCategory(
        { categoryId: "bags" },
        false,
        true,
        [],
        [],
        "analyze-existing",
      ).id,
    );
    assert.equal(queries.length, beforeQueries);
    assert.deepEqual(resumed.queries, []);
    assert.ok(
      resumed.analysisQueue.every((q: any) =>
        ["analyzed", "excluded"].includes(q.status),
      ),
    );
    assert.equal(
      resumed.timings.filter((t: any) => t.name === "基础分析队列").length,
      0,
    );
    delete process.env.CONTENT_CACHE_ONLY;
    const priorQueries = [...queries];
    const narrow = filteredCategory(
      done,
      Selection.parse({ categoryId: "bags", maxFollowers: 1000 }),
    );
    assert.equal(narrow.hotIds.length, 3);
    assert.equal(done.hotIds.length, 4);
    done.notes.push(
      ...Array.from({ length: 114 }, (_, i) => ({
        ...done.notes[0],
        id: "test-padding-" + i,
        metrics: { likes: 0, comments: 0, favorites: 0 },
        metricsRaw: { likes: "0", comments: "0", favorites: "0" },
      })),
    );
    save("category-run", done.id, done);
    const next = startCategory({ categoryId: "bags" }, false, true);
    const second = await wait(next.id);
    assert.equal(second.parentId, done.id);
    assert.equal(second.batch, 2);
    assert.ok(
      queries
        .slice(priorQueries.length)
        .every((q) => !priorQueries.includes(q)),
    );
    assert.ok(second.notes.length >= done.notes.length);
    delay = true;
    const cancelled = startCategory({ categoryId: "bags" }, true);
    cancelCategory(cancelled.id);
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(get<any>("category-run", cancelled.id).status, "cancelled");
    process.env.CATEGORY_BUDGET_MS = "20";
    const bounded = await wait(startCategory({ categoryId: "bags" }, true).id);
    assert.equal(bounded.status, "partial");
    assert.ok(bounded.elapsedMs < 500);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
