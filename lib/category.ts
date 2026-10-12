import { randomUUID } from "node:crypto";
import { z } from "zod";
import { get, list, save } from "./db";
import { Collector, metricEstimate } from "./collector";
import { model, modelConfigured } from "./model";
import { publicDataset } from "./public";
import type { Note, Timing } from "./schema";

export const categories = [
  {
    id: "bags",
    name: "包包",
    terms: [
      "包包",
      "包型",
      "背包",
      "手提包",
      "通勤包",
      "单肩包",
      "双肩包",
      "斜挎包",
      "托特包",
    ],
    children: ["通勤包", "托特包", "双肩包", "斜挎包"],
    queries: ["包包穿搭", "通勤包", "包包分享"],
  },
  {
    id: "clothes",
    name: "服饰",
    terms: ["穿搭", "衬衫", "裙", "外套", "服装"],
    children: ["衬衫", "裙子", "外套"],
    queries: ["服装穿搭", "日常穿搭", "通勤穿搭"],
  },
  {
    id: "shoes",
    name: "鞋履",
    terms: ["鞋", "靴"],
    children: ["运动鞋", "靴子"],
    queries: ["鞋子", "鞋子穿搭", "通勤鞋"],
  },
  {
    id: "home",
    name: "家居收纳",
    terms: ["收纳", "家居"],
    children: ["厨房收纳", "衣柜收纳"],
    queries: ["家居收纳", "厨房收纳", "衣柜收纳"],
  },
  {
    id: "beauty",
    name: "美妆",
    terms: ["化妆", "美妆", "口红", "粉底"],
    children: ["口红", "粉底"],
    queries: ["美妆", "口红", "化妆教程"],
  },
  {"id": "accessories", "name": "饰品配饰", "terms": ["耳饰", "项链", "戒指", "帽子", "围巾"], "children": ["耳饰", "项链", "戒指", "帽子", "围巾"], "queries": ["饰品", "配饰"]},
  {"id": "personal-care", "name": "护肤个护", "terms": ["护肤", "防晒", "洗护", "身体护理"], "children": ["护肤", "防晒", "洗护", "身体护理"], "queries": ["护肤", "个护"]},
  {"id": "food-drinks", "name": "食品饮品", "terms": ["零食", "咖啡", "茶", "冲饮"], "children": ["零食", "咖啡", "茶", "冲饮"], "queries": ["食品", "饮品"]},
  {"id": "digital-accessories", "name": "数码配件", "terms": ["手机壳", "耳机", "键盘", "支架"], "children": ["手机壳", "耳机", "键盘", "支架"], "queries": ["数码配件", "数码"]},
  {"id": "daily-home", "name": "家居日用", "terms": ["杯具", "餐具", "清洁用品", "床品"], "children": ["杯具", "餐具", "清洁用品", "床品"], "queries": ["家居日用", "日用品"]},
  {"id": "sports-outdoors", "name": "运动户外", "terms": ["健身用品", "露营装备", "骑行配件"], "children": ["健身用品", "露营装备", "骑行配件"], "queries": ["运动装备", "户外用品"]},
  {"id": "baby-kids", "name": "母婴用品", "terms": ["婴童服饰", "玩具", "喂养用品"], "children": ["婴童服饰", "玩具", "喂养用品"], "queries": ["母婴", "母婴用品"]},
  {"id": "pet-supplies", "name": "宠物用品", "terms": ["猫狗玩具", "窝垫", "出行用品"], "children": ["猫狗玩具", "窝垫", "出行用品"], "queries": ["宠物用品", "宠物"]},
  {"id": "stationery", "name": "文具文创", "terms": ["手账", "笔", "本子", "摆件"], "children": ["手账", "笔", "本子", "摆件"], "queries": ["文具", "文创"]},
  {"id": "toys", "name": "玩具潮玩", "terms": ["毛绒玩具", "盲盒", "模型"], "children": ["毛绒玩具", "盲盒", "模型"], "queries": ["玩具", "潮玩"]},
];
export const categoryIds = ["bags", "clothes", "shoes", "home", "beauty", "accessories", "personal-care", "food-drinks", "digital-accessories", "daily-home", "sports-outdoors", "baby-kids", "pet-supplies", "stationery", "toys"] as const;
export const capabilities = {
  platform: "xiaohongshu",
  sorts: ["最多点赞", "最多收藏", "最新"],
  noteTypes: ["视频", "图文"],
  providerTimes: ["一天内", "一周内", "半年内"],
  thirtyDays: "逐条详情日期校验",
  pagination: false,
  observation: "标题/正文；未分析帧或音频",
  douyin: false,
};
export const Selection = z.object({
  categoryId: z.enum(categoryIds),
  subcategory: z.string().max(30).default(""),
  style: z.string().max(30).default(""),
  scene: z.string().max(30).default(""),
  days: z.union([z.literal(30), z.literal(180)]).default(30),
});
export type SelectionType = z.infer<typeof Selection>;
export type Evidence = { noteId: string; quote: string };
export type Direction = {
  id: string;
  name: string;
  topic: string;
  concern: string;
  pattern: string;
  reason: string;
  evidence: Evidence[];
  noteIds: string[];
  authorCount: number;
  status: "confirmed" | "provisional";
  opening: string;
  shots: string[];
};
export type CategoryRun = {
  id: string;
  key: string;
  selection: SelectionType;
  dataVersion: 3;
  analysisVersion: 1;
  queries: string[];
  status: "running" | "complete" | "partial" | "cancelled";
  stage: string;
  createdAt: string;
  updatedAt: string;
  elapsedMs: number;
  firstCandidateMs: number | null;
  notes: Note[];
  deepIds: string[];
  validIds: string[];
  hotIds: string[];
  heatReasons: Record<string, string[]>;
  directions: Direction[];
  timings: Timing[];
  warnings: string[];
  source: "live";
  cancelRequested: boolean;
  budgetMs: number;
};
const controllers = new Map<string, AbortController>();
export function selectionKey(s: SelectionType) {
  return JSON.stringify(s);
}
export function categoryRuns() {
  return list<CategoryRun>("category-run");
}
export function latestCategory(s: SelectionType) {
  return categoryRuns().find((r) => r.key === selectionKey(s)) || null;
}
export function publicCategory(r: CategoryRun) {
  return {
    ...r,
    notes: publicDataset({
      provenance: {
        source: "live",
        collectedAt: r.createdAt,
        coverage: "有限查询首屏",
      },
      notes: r.notes,
      comments: [],
    }).notes,
  };
}
export function related(n: Note, s: SelectionType) {
  const c = categories.find((c) => c.id === s.categoryId)!;
  const text = n.title + "\n" + n.text;
  const hit = c.terms.find((t) => text.includes(t));
  return hit &&
    [s.subcategory, s.style, s.scene]
      .filter(Boolean)
      .every((t) => text.includes(t))
    ? hit
    : null;
}
export function validVideo(n: Note, s: SelectionType, now = Date.now()) {
  const time = n.publishedAt ? Date.parse(n.publishedAt) : NaN;
  return (
    n.contentType === "video" &&
    Number.isFinite(time) &&
    time <= now &&
    time >= now - s.days * 86400000 &&
    !!related(n, s)
  );
}
export function selectHeat(notes: Note[]) {
  const reasons: Record<string, string[]> = {};
  // Small samples still require meaningful absolute engagement. Thresholds are product rules, not platform-wide benchmarks.
  for (const [field, floor, label] of [
    ["likes", 1000, "点赞"],
    ["favorites", 300, "收藏"],
    ["comments", 50, "评论"],
  ] as const) {
    const ranked = notes
      .map((n) => ({
        n,
        ...metricEstimate(n.metricsRaw?.[field] ?? n.metrics[field]),
      }))
      .filter((x) => x.value !== null)
      .sort((a, b) => b.value! - a.value!);
    for (const x of ranked.slice(
      0,
      Math.max(1, Math.ceil(ranked.length * 0.25)),
    )) {
      if (x.value! < floor) continue;
      (reasons[x.n.id] ||= []).push(
        `${label} ${x.n.metricsRaw?.[field] ?? x.value}，样本内前25%且达到产品门槛${floor}${x.mode !== "exact" ? "（近似/下界）" : ""}`,
      );
    }
  }
  return reasons;
}
const Cards = z.object({
  directions: z
    .array(
      z.object({
        name: z.string(),
        topic: z.string(),
        concern: z.string(),
        pattern: z.string(),
        reason: z.string(),
        evidence: z
          .array(z.object({ noteId: z.string(), quote: z.string().min(4) }))
          .min(1),
        opening: z.string(),
        shots: z.array(z.string()).min(3).max(5),
      }),
    )
    .max(5),
});
export function validateDirections(
  raw: z.infer<typeof Cards>,
  notes: Note[],
  hotIds: string[],
): Direction[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  return raw.directions.flatMap((d, i) => {
    const evidence = d.evidence.filter(
      (e) =>
        hotIds.includes(e.noteId) &&
        (byId.get(e.noteId)?.title + "\n" + byId.get(e.noteId)?.text).includes(
          e.quote,
        ),
    );
    // Identical text from reposts does not count as independent market evidence.
    const signatures = new Set<string>();
    const noteIds = [...new Set(evidence.map((e) => e.noteId))].filter((id) => {
      const n = byId.get(id)!;
      const sig = (n.title + n.text).replace(/\s/g, "");
      if (signatures.has(sig)) return false;
      signatures.add(sig);
      return true;
    });
    const signature = [...noteIds].sort().join("|");
    if (!noteIds.length || seen.has(signature)) return [];
    seen.add(signature);
    const authorCount = new Set(
      noteIds.map((id) => byId.get(id)!.creatorId).filter(Boolean),
    ).size;
    return [
      {
        ...d,
        evidence: evidence.filter((e) => noteIds.includes(e.noteId)),
        id: `direction-${i}`,
        noteIds,
        authorCount,
        status:
          noteIds.length >= 3 && authorCount >= 2
            ? ("confirmed" as const)
            : ("provisional" as const),
      },
    ];
  });
}
function persist(r: CategoryRun) {
  if (get<CategoryRun>("category-run", r.id)?.cancelRequested) {
    r.cancelRequested = true;
    r.status = "cancelled";
  }
  r.updatedAt = new Date().toISOString();
  r.elapsedMs = Date.now() - Date.parse(r.createdAt);
  save("category-run", r.id, r);
}
export function cancelCategory(id: string) {
  const r = get<CategoryRun>("category-run", id);
  if (!r) throw Error("任务不存在");
  r.cancelRequested = true;
  r.status = "cancelled";
  persist(r);
  controllers.get(id)?.abort();
}
export function startCategory(input: unknown, force = false) {
  const selection = Selection.parse(input);
  const c = categories.find((c) => c.id === selection.categoryId)!;
  if (selection.subcategory && !c.children.includes(selection.subcategory))
    throw Error("子类不属于当前类目");
  const old = latestCategory(selection);
  if (old?.status === "running" && controllers.has(old.id)) return old;
  const inFlight = categoryRuns().find(
    (r) =>
      r.status === "running" &&
      Date.now() - Date.parse(r.createdAt) < r.budgetMs + 10000,
  );
  if (inFlight) {
    if (inFlight.key === selectionKey(selection)) return inFlight;
    throw Error("单浏览器正在采集另一类目，请等待结束或取消该任务");
  }
  if (
    !force &&
    old &&
    old.status === "complete" &&
    Date.now() - Date.parse(old.updatedAt) < 20 * 60000
  )
    return old;
  const seed = [selection.subcategory, selection.style, selection.scene]
    .filter(Boolean)
    .join(" ");
  const queries = seed
    ? [`${c.name} ${seed}`, `${c.name} ${seed} 穿搭`, `${c.name} ${seed} 分享`]
    : c.queries;
  const r: CategoryRun = {
    id: randomUUID(),
    key: selectionKey(selection),
    selection,
    dataVersion: 3,
    analysisVersion: 1,
    queries,
    status: "running",
    stage: "搜索候选",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    elapsedMs: 0,
    firstCandidateMs: null,
    notes: [],
    deepIds: [],
    validIds: [],
    hotIds: [],
    heatReasons: {},
    directions: [],
    timings: [],
    warnings: [
      "有限首屏样本；近30天由详情校验；未观察视频画面；热度为快照，未经发布时长校准",
      "热度门槛：点赞1000/收藏300/评论50的样本前25%并集；正式方向≥3视频、≥2作者",
    ],
    source: "live",
    cancelRequested: false,
    budgetMs: Number(process.env.CATEGORY_BUDGET_MS || 300000),
  };
  persist(r);
  void executeCategory(r, force);
  return r;
}
export async function executeCategory(r: CategoryRun, force = false) {
  const abort = new AbortController();
  controllers.set(r.id, abort);
  const timer = setTimeout(() => abort.abort(), r.budgetMs);
  timer.unref();
  const collector = new Collector({
    v2: true,
    forceRefresh: force,
    signal: abort.signal,
    onTiming: (t) => {
      r.timings.push(t);
      persist(r);
    },
  });
  const stage = async (name: string, fn: () => Promise<void>) => {
    r.stage = name;
    persist(r);
    const start = Date.now();
    try {
      await fn();
    } finally {
      r.timings.push({
        name,
        start: new Date(start).toISOString(),
        end: new Date().toISOString(),
        ms: Date.now() - start,
        status: abort.signal.aborted ? "interrupted" : "finished",
        retries: 0,
        count: r.notes.length,
        cacheHit: false,
      });
      persist(r);
    }
  };
  try {
    await stage("搜索候选", async () => {
      for (const [i, q] of r.queries.entries()) {
        if (abort.signal.aborted) break;
        try {
          const result = await collector.searchNotes(q, {
            note_type: "视频",
            sort_by: i === 2 ? "最新" : i === 1 ? "最多收藏" : "最多点赞",
            publish_time: "半年内",
          });
          const map = new Map(r.notes.map((n) => [n.id, n]));
          for (const n of result.items) if (!map.has(n.id)) map.set(n.id, n);
          r.notes = [...map.values()].slice(0, 60);
          r.firstCandidateMs ??= Date.now() - Date.parse(r.createdAt);
          persist(r);
        } catch (e) {
          r.warnings.push(e instanceof Error ? e.message : "搜索失败");
        }
      }
    });
    await stage("视频日期与正文核验", async () => {
      const candidates = r.notes.filter(
        (n) => n.contentType === "video" && related(n, r.selection),
      );
      const searchHeat = selectHeat(candidates);
      candidates.sort(
        (a, b) =>
          Number(!!searchHeat[b.id]) - Number(!!searchHeat[a.id]) ||
          (metricEstimate(b.metricsRaw?.likes ?? b.metrics.likes).value || 0) -
            (metricEstimate(a.metricsRaw?.likes ?? a.metrics.likes).value || 0),
      );
      // Sequential calls protect the single shared browser.
      for (const n of candidates.slice(0, 8)) {
        if (abort.signal.aborted) break;
        try {
          const full = (await collector.getNote(n)).items[0];
          if (full.id !== n.id) throw Error("详情ID不匹配");
          r.notes = r.notes.map((x) =>
            x.id === n.id
              ? { ...full, images: full.images.length ? full.images : n.images }
              : x,
          );
          r.deepIds.push(n.id);
        } catch (e) {
          r.warnings.push(e instanceof Error ? e.message : "正文失败");
        }
        r.validIds = r.notes
          .filter((n) => validVideo(n, r.selection))
          .map((n) => n.id);
        r.heatReasons = selectHeat(
          r.notes.filter((n) => r.validIds.includes(n.id)),
        );
        r.hotIds = Object.keys(r.heatReasons);
        persist(r);
      }
    });
    await stage("方向聚合与证据校验", async () => {
      if (!r.hotIds.length) {
        r.warnings.push(
          "未取得同时满足类目、日期、视频类型和热度门槛的内容；不生成方向",
        );
        return;
      }
      if (!modelConfigured()) {
        r.warnings.push("模型未配置，真实高热参考已保留");
        return;
      }
      const raw = await model(
        "V3类目方向",
        Cards,
        {
          category: r.selection,
          instruction:
            "仅基于标题/正文聚合不同主题/场景/形式；每条引用必须逐字摘录。排除与类目无关内容，不预置方向。concern为文案关注主题而非真实用户提问。opening和shots只能是AI建议。支持同一模式的视频才聚为一组，不声称看过镜头、字幕或趋势。",
          notes: r.notes
            .filter((n) => r.hotIds.includes(n.id))
            .map((n) => ({
              id: n.id,
              title: n.title,
              text: n.text.slice(0, 3500),
              categoryEvidence: related(n, r.selection),
            })),
        },
        (ms, tokens) => {
          r.timings.push({
            name: `model:tokens=${tokens}`,
            start: new Date(Date.now() - ms).toISOString(),
            end: new Date().toISOString(),
            ms,
            status: "returned",
            retries: 0,
            count: r.hotIds.length,
            cacheHit: false,
          });
        },
        abort.signal,
      );
      r.directions = validateDirections(raw, r.notes, r.hotIds);
      r.directions.sort(
        (a, b) =>
          b.noteIds.length - a.noteIds.length || b.authorCount - a.authorCount,
      );
    });
    r.status =
      abort.signal.aborted ||
      !r.notes.length ||
      !r.deepIds.length ||
      (r.hotIds.length > 0 && !r.directions.length)
        ? "partial"
        : "complete";
  } catch (e) {
    r.warnings.push(e instanceof Error ? e.message : "任务失败");
    r.status = "partial";
  } finally {
    clearTimeout(timer);
    const cancelled = get<CategoryRun>("category-run", r.id)?.cancelRequested;
    if (cancelled) {
      r.status = "cancelled";
      r.cancelRequested = true;
    } else if (abort.signal.aborted)
      r.warnings.push("达到总时间预算；已有结果保留");
    r.stage = "已结束";
    persist(r);
    controllers.delete(r.id);
  }
}
