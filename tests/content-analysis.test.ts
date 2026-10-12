import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
process.env.DB_PATH = resolve(mkdtempSync("./data/queue-test-"), "test.sqlite");
const { analyzeQueue, contentHash, groupKey, validateCards } =
  await import("../lib/content-analysis");
const { Selection, refresh } = await import("../lib/category-v4");
const facets = (theme = "日常包搭配", quote = "日常包搭配") =>
  Object.fromEntries(
    ["productType", "theme", "scene", "audience", "format"].map((k) => [
      k,
      {
        value: k === "theme" ? theme : null,
        quote: k === "theme" ? quote : "",
      },
    ]),
  ) as any;
const note = (i: number) =>
  ({
    id: "note:" + i,
    title: "日常包搭配 " + i,
    text: "秋冬日常包搭配与通勤收纳",
    creatorId: "u" + i,
    contentType: "video",
    publishedAt: new Date().toISOString(),
    metrics: { likes: 773, comments: 38, favorites: 10 },
    queries: [],
    images: [],
  }) as any;
const run = (n = 43) =>
  ({
    selection: Selection.parse({ categoryId: "bags" }),
    notes: Array.from({ length: n }, (_, i) => note(i)),
    analysisQueue: [],
    classifications: [],
    followers: {},
    commentReviews: [],
    directions: [],
    qualifiedIds: [],
    timings: [],
    warnings: [],
    searches: [],
  }) as any;
test("余额不足保留队列且不消耗内容重试，服务恢复可完成分析", async()=>{
  process.env.MODEL_BASE_URL="http://model.test";process.env.MODEL_NAME="test";process.env.MODEL_API_KEY="test";
  const old=globalThis.fetch;let available=false,calls=0;
  globalThis.fetch=async(_url,options)=>{calls++;if(!available)return new Response(JSON.stringify({error:{message:"Insufficient Balance"}}),{status:402});
    const input=JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({data:{items:input.notes.map((n:any)=>({noteId:n.noteId,relevant:true,quote:"日常包搭配",reason:"包类搭配主题",facets:facets()}))}})}}]}));
  };
  try{const r=run(20);r.notes=r.notes.map((n:any)=>({...n,id:"balance:"+n.id}));
    await analyzeQueue(r,new AbortController().signal,Date.now()+120000,()=>{});
    assert.equal(calls,1);assert.ok(r.analysisQueue.every((q:any)=>q.status==="queued"&&q.attempts===0));assert.equal(r.timings.at(-1).status,"partial");
    available=true;await analyzeQueue(r,new AbortController().signal,Date.now()+120000,()=>{});
    assert.equal(r.analysisQueue.filter((q:any)=>q.status==="analyzed").length,20);assert.equal(calls,3);
  }finally{globalThis.fetch=old;}
});
test("43条按18/18/7持久化分析；续跑零调用；同长度改文重新分析一条", async () => {
  process.env.MODEL_BASE_URL = "http://model.test";
  process.env.MODEL_NAME = "test";
  process.env.MODEL_API_KEY = "test";
  const old = globalThis.fetch;
  const batches: number[] = [];
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(
      JSON.parse(String(options?.body)).messages[1].content,
    );
    batches.push(input.notes.length);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                data: {
                  items: input.notes.map((n: any) => ({
                    noteId: n.noteId,
                    relevant: true,
                    quote: "日常包搭配",
                    reason: "包类搭配主题",
                    facets: facets(),
                  })),
                },
              }),
            },
          },
        ],
      }),
    );
  };
  try {
    const r = run();
    await analyzeQueue(
      r,
      new AbortController().signal,
      Date.now() + 120000,
      () => {},
    );
    assert.deepEqual(batches, [18, 18, 7]);
    assert.equal(
      r.analysisQueue.filter((q: any) => q.status === "analyzed").length,
      43,
    );
    await analyzeQueue(
      r,
      new AbortController().signal,
      Date.now() + 120000,
      () => {},
    );
    assert.equal(batches.length, 3);
    const hash = contentHash(r.notes[0], "bags");
    r.notes[0].text = r.notes[0].text.replace("秋冬", "春夏");
    assert.notEqual(contentHash(r.notes[0], "bags"), hash);
    await analyzeQueue(
      r,
      new AbortController().signal,
      Date.now() + 120000,
      () => {},
    );
    assert.deepEqual(batches, [18, 18, 7, 1]);
  } finally {
    globalThis.fetch = old;
  }
});
test("缺失一条输出不会阻塞其他内容，失败最多两次", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const input = JSON.parse(
      JSON.parse(String(options?.body)).messages[1].content,
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                data: {
                  items: input.notes
                    .filter((n: any) => n.noteId !== "note:0")
                    .map((n: any) => ({
                      noteId: n.noteId,
                      relevant: true,
                      quote: "日常包搭配",
                      reason: "包类",
                      facets: facets(),
                    })),
                },
              }),
            },
          },
        ],
      }),
    );
  };
  try {
    const r = run(43);
    r.selection = Selection.parse({ categoryId: "shoes" });
    r.notes[0].title += "改";
    await analyzeQueue(
      r,
      new AbortController().signal,
      Date.now() + 120000,
      () => {},
    );
    await analyzeQueue(
      r,
      new AbortController().signal,
      Date.now() + 120000,
      () => {},
    );
    await analyzeQueue(
      r,
      new AbortController().signal,
      Date.now() + 120000,
      () => {},
    );
    assert.equal(calls, 4);
    assert.equal(
      r.analysisQueue.filter((q: any) => q.status === "analyzed").length,
      42,
    );
    assert.equal(r.analysisQueue[0].status, "failed");
  } finally {
    globalThis.fetch = old;
  }
});
test("日常包与追星痛包分组；混组及标签摘要被拒绝；真实关联只包含支持视频", () => {
  const r = run(2);
  r.notes[1].title = "演唱会追星痛包";
  r.classifications = [
    { noteId: "note:0", status: "verified-text", facets: facets() },
    {
      noteId: "note:1",
      status: "verified-text",
      facets: facets("追星痛包", "追星痛包"),
    },
  ];
  assert.notEqual(
    groupKey(r.classifications[0], "note:0"),
    groupKey(r.classifications[1], "note:1"),
  );
  const card = {
    theme: "秋冬日常包搭配清单",
    core: "基于通勤需求组织随身物品的选包参考",
    interactionObservation: null,
    angle: "从通勤需求切入日常收纳和搭配",
    organization: [
      "先列出日常通勤需要携带的物品",
      "再按实际需求说明选择包的思路",
    ],
    interactionAdvice: "邀请读者分享最常携带的通勤物品",
    observations: [
      {
        noteId: "note:0",
        quote: "日常包搭配",
        claim: "标题以日常包搭配为主题",
      },
    ],
    associations: [
      {
        noteId: "note:0",
        quote: "日常包搭配",
        reason: "标题支持日常搭配创作主题",
      },
    ],
  };
  assert.deepEqual(validateCards({ cards: [card] }, r, ["note:0"])[0].noteIds, [
    "note:0",
  ]);
  r.commentReviews = [
    { noteId: "note:0", items: [{ id: "c:real", text: "这款包能装下电脑吗" }] },
  ];
  assert.equal(validateCards({cards:[{...card,theme:"通勤收纳的图文步骤补充",core:"文字关注通勤收纳问题，可回应读者对图文步骤的请求"}]},r,["note:0"]).length,1);
  assert.equal(
    validateCards(
      {
        cards: [
          {
            ...card,
            observations: [
              {
                noteId: "note:0",
                quote: "能装下电脑吗",
                claim: "已读取评论关注电脑收纳需求",
              },
            ],
          },
        ],
      },
      r,
      ["note:0"],
    ).length,
    1,
  );
  assert.equal(
    validateCards(
      {
        cards: [
          {
            ...card,
            observations: [
              {
                noteId: "note:0",
                quote: "虚构评论",
                claim: "观众要求完全不存在的商品特性",
              },
            ],
          },
        ],
      },
      r,
      ["note:0"],
    ).length,
    0,
  );
  assert.equal(
    validateCards({ cards: [{ ...card, theme: "#包包分享[话题]#" }] }, r, [
      "note:0",
    ]).length,
    0,
  );
  assert.equal(
    validateCards(
      {
        cards: [
          {
            ...card,
            associations: [
              ...card.associations,
              {
                noteId: "note:1",
                quote: "追星痛包",
                reason: "追星痛包是独立的内容主题",
              },
            ],
          },
        ],
      },
      r,
      ["note:0", "note:1"],
    ).length,
    0,
  );
});
