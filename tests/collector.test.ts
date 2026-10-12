import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Collector } from "../lib/collector";
test("真实REST契约模拟：搜索、带token详情、评论不可读、主页作品及重复读取", async () => {
  const requests: { path: string; body: any }[] = [];
  let unreadable = false;
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const body = text ? JSON.parse(text) : null;
    requests.push({ path: req.url!, body });
    let data: any;
    if (req.url === "/api/v1/feeds/search")
      data = {
        feeds: [
          {
            id: "note1",
            xsecToken: "test-token",
            noteCard: {
              displayTitle: "收纳",
              user: { userId: "author1", nickname: "测试作者" },
              interactInfo: { likedCount: "1.2万" },
            },
          },
        ],
      };
    else if (req.url === "/api/v1/feeds/detail")
      data = {
        data: {
          note: {
            noteId: "note1",
            title: "收纳",
            desc: "真实字段测试正文",
            time: 1700000000000,
            user: { userId: "author1" },
            interactInfo: { likedCount: "100" },
          },
          ...(unreadable ? {} : { comments: { list: [], hasMore: false } }),
        },
      };
    else if (req.url === "/api/v1/user/profile")
      data = {
        data: {
          feeds: [
            {
              id: "post1",
              xsecToken: "post-token",
              noteCard: { displayTitle: "作品", user: { userId: "author1" } },
            },
          ],
        },
      };
    else {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("bind");
  process.env.XHS_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const collector = new Collector();
    const search = await collector.searchNotes("收纳");
    assert.equal(search.items[0].metrics.likes, null);
    assert.equal(search.items[0].metricsRaw?.likes, "1.2万");
    const n = search.items[0];
    const detail = await collector.getNote(n);
    assert.equal(detail.items[0].text, "真实字段测试正文");
    assert.equal(
      requests.find((r) => r.path.endsWith("/detail"))!.body.xsec_token,
      "test-token",
    );
    const comments = await collector.getComments(n);
    assert.equal(comments.status, "ok");
    assert.equal(comments.items.length, 0);
    unreadable = true;
    const noComments = await new Collector().getComments(n);
    assert.equal(noComments.status, "unavailable");
    assert.equal(noComments.items.length, 0);
    for (let i = 0; i < 2; i++) {
      const posts = await collector.getCreatorPosts({
        id: "author1",
        xsecToken: "test-token",
      });
      assert.equal(posts.items.length, 1);
      assert.equal(posts.items[0].kind, "creator-post");
    }
    assert.equal(
      requests.filter((r) => r.path === "/api/v1/user/profile").length,
      2,
    );
    await assert.rejects(
      () => collector.getNote({ ...n, ref: undefined }),
      /缺少详情/,
    );
    unreadable = false;
    const v2 = new Collector({ v2: true });
    const bodyStart = requests.length;
    const bodyNote = await v2.getNote(n);
    const bodyRequest = requests[bodyStart].body;
    assert.equal(bodyRequest.load_all_comments, false);
    assert.equal(bodyRequest.comment_config.click_more_replies, false);
    await v2.getComments(n, undefined, { maxItems: 12 });
    assert.equal(requests.at(-1)!.body.load_all_comments, true);
    assert.equal(requests.at(-1)!.body.comment_config.max_comment_items, 12);
    assert.equal(
      requests.at(-1)!.body.comment_config.click_more_replies,
      false,
    );
    const requestCount = requests.length;
    const reused = await new Collector({ v2: true }).getNote(n);
    assert.equal(requests.length, requestCount);
    assert.equal(reused.items[0].collectedAt, bodyNote.items[0].collectedAt);
  } finally {
    await new Promise<void>((r, reject) =>
      server.close((e) => (e ? reject(e) : r())),
    );
  }
});
