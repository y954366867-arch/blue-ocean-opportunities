import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateClusters,
  validateCards,
  summaryFingerprint,
  consolidateGroups,
} from "../lib/content-analysis";
import {
  Selection,
  ensureInspirations,
  type CategoryRun,
} from "../lib/category-v4";
const setup = () => {
  const notes = [
    {
      id: "a",
      title: "秋冬通勤托特包",
      text: "每天上班装电脑通勤",
      creatorId: "u1",
    },
    {
      id: "b",
      title: "日常通勤斜挎包",
      text: "每天上班的通勤包选择",
      creatorId: "u2",
    },
  ] as any;
  const r = {
    selection: Selection.parse({ categoryId: "bags" }),
    notes,
    qualifiedIds: ["a", "b"],
    directions: [],
    commentReviews: [],
    classifications: notes.map((n: any, i: number) => ({
      noteId: n.id,
      status: "verified-text",
      facets: {
        productType: { value: i ? "斜挎包" : "托特包", quote: n.title },
        theme: { value: i ? "日常通勤" : "秋冬通勤", quote: n.title },
        scene: { value: "通勤", quote: "通勤" },
        audience: { value: null, quote: "" },
        format: { value: i ? "选包" : "分享", quote: n.title },
      },
    })),
  } as unknown as CategoryRun;
  return r;
};
const proposed = (ids = ["a", "b"], existingGroupId: string | null = null) => ({
  groups: [
    {
      existingGroupId,
      theme: "日常通勤包的实用选择",
      commonPoint: "多条内容围绕每天上班时的通勤包选择展开",
      associations: ids.map((noteId) => ({
        noteId,
        reason: "标题和正文支持日常通勤共同主题",
        quote: "通勤",
      })),
    },
  ],
  pendingIds: [],
});
const card = (ids = ["a", "b"]) => ({
  theme: "日常通勤包的实用选择",
  core: "基于通勤需求组织随身物品的选包参考",
    interactionObservation: null,
    angle: "从每天上班需要携带的物品切入选包",
  organization: [
    "先列出实际携带物品和通勤需求",
    "再讨论不同包型满足需求的差异",
  ],
  interactionAdvice: "邀请观众分享每天通勤必带的一件物品",
  observations: ids.map((noteId) => ({
    noteId,
    claim: "正文围绕通勤包选择展开",
    quote: "通勤",
  })),
  associations: ids.map((noteId) => ({
    noteId,
    reason: "文字支持日常通勤选包共同主题",
    quote: "通勤",
  })),
});
test("全局审核把不同措辞的重复单条组合成一组，保留ID和双方视频", () => {
  const r=setup();
  const raw=proposed(["a"]);
  raw.groups[0].theme="通勤包开箱实用分享";
  raw.groups.push({...proposed(["b"]).groups[0],theme:"上班选包避坑干货"});
  const draft=validateClusters(raw,r,[]);
  assert.equal(draft.length,2);
  const comparison={left:draft[0].id,right:draft[1].id,merge:true,theme:"通勤选包的实际装载需求",commonPoint:"共同回答日常通勤物品如何选择合适的包",reason:"开箱与避坑表达形式不同但创作问题一致",evidence:[{noteId:"a",quote:"通勤",reason:"支持通勤选包的真实文字"},{noteId:"b",quote:"通勤",reason:"支持通勤选包的真实文字"}]};
  const merged=consolidateGroups({comparisons:[comparison]},r,draft);
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,draft[0].id);
  assert.deepEqual(merged[0].noteIds,["a","b"]);
  assert.equal(consolidateGroups({comparisons:[{...comparison,evidence:[comparison.evidence[0],{...comparison.evidence[1],quote:"虚构原文"}]}]},r,draft).length,2);
  assert.equal(consolidateGroups({comparisons:[{...comparison,merge:false}]},r,draft).length,2);
});
test("主卡不接受标签堆砌、夸大评论数量、过多建议或虚称共同点", () => {
  const r = setup();
  r.contentGroups = validateClusters(proposed(), r, []);
  const invalid = [
    {...card(), organization:["正文堆入#通勤 #包包标签即可"]},
    {...card(), interactionAdvice:"大量用户求链接，可以直接回复"},
    {...card(), organization:Array(4).fill("展示具体通勤需求与选包差异")},
    {...card(), core:"单条图文形成共同创作方向"},
  ];
  for(const c of invalid) assert.equal(validateCards({cards:[c]},r,["a","b"]).length,0);
  const optional={...card(),interactionAdvice:null,interactionObservation:null};
  assert.equal(validateCards({cards:[optional]},r,["a","b"]).length,1);
});
test("不同包型与细主题的相似内容按共同点聚合，每组仅一张卡", () => {
  const r = setup();
  r.contentGroups = validateClusters(proposed(), r, []);
  assert.equal(r.contentGroups.length, 1);
  const cards = validateCards({ cards: [card()] }, r, ["a", "b"]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].noteIds, ["a", "b"]);
  assert.equal(
    validateCards({ cards: [card(), card()] }, r, ["a", "b"]).length,
    0,
  );
});
test("新视频追加原组，保留组和卡ID，并使总结缓存失效", () => {
  const r = setup();
  r.qualifiedIds = ["a"];
  const prior = validateClusters(proposed(["a"]), r, []);
  const before = summaryFingerprint(r, ["a"]);
  r.qualifiedIds = ["a", "b"];
  r.contentGroups = validateClusters(
    proposed(["a", "b"], prior[0].id),
    r,
    prior,
  );
  assert.equal(r.contentGroups[0].id, prior[0].id);
  assert.equal(
    validateCards({ cards: [card()] }, r, ["a", "b"])[0].id,
    prior[0].id,
  );
  assert.notEqual(before, summaryFingerprint(r, ["a", "b"]));
});
test("重复组成员、标签主题与旧版本卡片拒绝展示", () => {
  const r = setup();
  const raw = proposed();
  raw.groups.push({ ...raw.groups[0], theme: "换个说法的通勤包" });
  assert.equal(validateClusters(raw, r, []).length, 1);
  assert.equal(
    validateClusters(
      {
        groups: [{ ...raw.groups[0], theme: "#通勤包[话题]#" }],
        pendingIds: [],
      },
      r,
      [],
    ).length,
    0,
  );
  r.directions = [
    {
      id: "legacy",
      noteIds: ["a"],
      summaryStatus: "ready",
      summaryHash: summaryFingerprint(r, ["a"]),
    },
  ] as any;
  ensureInspirations(r);
  assert.ok(!r.directions.some((d) => d.id === "legacy"));
});
