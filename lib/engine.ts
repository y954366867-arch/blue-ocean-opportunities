import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { saveRun, get, list, save } from "./db";
import { Collector } from "./collector";
import { model } from "./model";
import { AnalysisSchema, type Product, type Run, type Dataset } from "./schema";
import {
  applyCorrections,
  dedupe,
  shortlist,
  validateAnalysis,
} from "./validation";
import { publicDataset } from "./public";
import { executeV2 } from "./engine-v2";
const globalJobs = globalThis as unknown as { botJobs?: Set<string> };
const jobs = (globalJobs.botJobs ??= new Set());
export function runs() {
  const rs = list<Run>("run");
  for (const r of rs)
    if (["queued", "running"].includes(r.status) && !jobs.has(r.id)) {
      r.status = r.cancelRequested ? "cancelled" : "failed";
      r.stage = "进程中断，已保留阶段数据，可重试";
      saveRun(r);
    }
  return rs;
}
export function createRun(
  product: Product,
  queries: string[],
  dataset?: Dataset,
  engineVersion: 1 | 2 = 2,
  forceRefresh = false,
) {
  const r: Run = {
    id: randomUUID(),
    ...(engineVersion === 2 ? { engineVersion: 2 as const } : {}),
    timings: [],
    forceRefresh,
    product,
    queries,
    status: "queued",
    stage: "等待开始",
    done: 0,
    total: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataset: dataset || {
      provenance: {
        source: "live",
        collectedAt: new Date().toISOString(),
        coverage: "搜索首屏及有限深读，不代表全平台",
      },
      notes: [],
      comments: [],
    },
    errors: [],
    cancelRequested: false,
    result: null,
    history: [],
    corrections: [],
    usage: [],
    calls: 0,
    collectedQueries: [],
    deepReadIds: [],
    creatorReadIds: [],
  };
  saveRun(r);
  launch(r.id);
  return r;
}
export function launch(
  id: string,
  analysisOnly = false,
  mode: "full" | "budget" | "preference" = "full",
) {
  if (jobs.has(id)) throw Error("任务正在运行");
  jobs.add(id);
  void (
    get<Run>("run", id)?.engineVersion === 2
      ? executeV2(id, analysisOnly)
      : execute(id, analysisOnly, mode)
  ).finally(() => jobs.delete(id));
}
async function execute(
  id: string,
  analysisOnly: boolean,
  mode: "full" | "budget" | "preference",
) {
  let r = get<Run>("run", id)!;
  const collector = new Collector();
  const check = () => {
    const latest = get<Run>("run", id)!;
    if (latest.cancelRequested) throw Error("CANCELLED");
  };
  const update = (stage: string, done = 0, total = 0) => {
    check();
    r.stage = stage;
    r.done = done;
    r.total = total;
    saveRun(r);
  };
  const ask = async <T>(stage: string, schema: z.ZodType<T>, data: unknown) => {
    check();
    const cacheKey =
      id +
      ":" +
      createHash("sha256")
        .update(
          JSON.stringify({
            stage,
            data,
            schema: z.toJSONSchema(schema),
            model: process.env.MODEL_NAME,
          }),
        )
        .digest("hex");
    const cached = get<T>("stage-output", cacheKey);
    if (cached !== null) return schema.parse(cached);
    if (r.calls + 2 > Number(process.env.MODEL_MAX_CALLS || 24))
      throw Error("达到本次模型调用上限；调整预算后可重试");
    r.calls += 2;
    saveRun(r);
    const v = await model(stage, schema, data, (ms, tokens) => {
      r.usage.push({ stage, ms, tokens });
      saveRun(r);
    });
    check();
    save("stage-output", cacheKey, v);
    return v;
  };
  try {
    check();
    r.status = "running";
    saveRun(r);
    const previous = r.history.at(-1);
    if (mode !== "full" && previous) {
      const data = applyCorrections(r.dataset, r.corrections);
      const draft = structuredClone(previous);
      if (mode === "preference") {
        update("仅调整内容表达");
        const edits = await ask(
          "仅重写标题、切入点与拍摄步骤；不得改变受众、场景、事实、限制或证据",
          z
            .array(
              z.object({
                id: z.string(),
                title: z.string(),
                angle: z.string(),
                steps: z.array(z.string()).min(3).max(5),
              }),
            )
            .max(3),
          {
            product: r.product,
            topics: previous.topics,
            preferences: r.corrections.filter((c) => c.kind === "preference"),
          },
        );
        draft.topics = previous.topics.map((t) => ({
          ...t,
          ...edits.find((e) => e.id === t.id),
        }));
      } else {
        update("重评达人合作可行性");
        const edits = await ask(
          "只根据新预算重评已有达人合作可行性；没有报价不能认定预算足够或不足；不更换达人、不改变选题或需求",
          z
            .array(
              z.object({
                creatorId: z.string(),
                status: z.enum(["适合进一步了解", "信息不足", "暂不推荐"]),
                reason: z.string(),
                mismatch: z.string(),
                unknowns: z.array(z.string()),
                questions: z.array(z.string()),
              }),
            )
            .max(5),
          { product: r.product, creators: previous.creators },
        );
        draft.creators = previous.creators.map((c) => ({
          ...c,
          ...edits.find((e) => e.creatorId === c.creatorId),
        }));
      }
      const checked = validateAnalysis(
        draft,
        data,
        r.product,
        (previous.analysisVersion || 0) + 1,
      );
      await semanticAudit(checked, data);
      check();
      r.result = checked;
      r.history.push(checked);
      r.status = "complete";
      r.stage = "研究完成";
      r.done = r.total = 1;
      saveRun(r);
      return;
    }
    if (r.dataset.provenance.source === "live" && !analysisOnly) {
      update("检查小红书登录");
      const login = await collector.loginStatus();
      if (login.is_logged_in !== true)
        throw Error("小红书尚未登录，请在连接设置中扫码后重试");
      for (let i = 0; i < r.queries.length; i++) {
        if (r.collectedQueries.includes(r.queries[i])) continue;
        update("搜索与去重", i, r.queries.length);
        const result = await collector.searchNotes(r.queries[i]);
        r.dataset.notes = dedupe([...r.dataset.notes, ...result.items]).slice(
          0,
          50,
        );
        r.errors.push(...result.warnings);
        r.collectedQueries.push(r.queries[i]);
        saveRun(r);
      }
    }
    let data = applyCorrections(r.dataset, r.corrections);
    if (!data.notes.length) throw Error("没有可分析笔记，请调整查询或导入数据");
    const Rel = AnalysisSchema.shape.relevance;
    let relevance: z.infer<typeof Rel> = [];
    for (let i = 0; i < data.notes.length; i += 15) {
      update("判断场景相关性", i, data.notes.length);
      relevance.push(
        ...(await ask("场景相关性", Rel, {
          product: r.product,
          notes: publicDataset({
            ...data,
            notes: data.notes.slice(i, i + 15),
            comments: [],
          }).notes,
          corrections: r.corrections,
        })),
      );
    }
    if (r.dataset.provenance.source === "live" && !analysisOnly) {
      const selected = shortlist(
        data.notes.filter((n) =>
          relevance.some(
            (x) =>
              x.noteId === n.id && ["direct", "adjacent"].includes(x.status),
          ),
        ),
      );
      for (let i = 0; i < selected.length; i++) {
        const n = selected[i];
        if (r.deepReadIds.includes(n.id)) continue;
        update("深读正文与评论", i, selected.length);
        try {
          const result = await collector.getNote(n);
          r.dataset.notes = dedupe([...r.dataset.notes, ...result.items]);
          const cs = await collector.getComments(n);
          r.dataset.comments = [
            ...new Map(
              [...r.dataset.comments, ...cs.items].map((x) => [x.id, x]),
            ).values(),
          ];
          r.errors.push(...cs.warnings);
          if (cs.status === "unavailable") r.errors.push(`${n.id} 评论不可读`);
          else r.deepReadIds.push(n.id);
        } catch (e) {
          r.errors.push(
            `${n.id}: ${e instanceof Error ? e.message : "详情失败"}`,
          );
        }
        saveRun(r);
      }
      const authors = [
        ...new Map(
          selected
            .filter((n) => r.deepReadIds.includes(n.id))
            .map((n) => [n.creatorId, n]),
        ).values(),
      ].slice(0, 5);
      for (let i = 0; i < authors.length; i++) {
        const n = authors[i];
        if (!n.creatorId || r.creatorReadIds.includes(n.creatorId)) continue;
        update("读取作者作品", i, authors.length);
        try {
          const result = await collector.getCreatorPosts({
            id: n.creatorId,
            xsecToken: n.ref?.xsecToken || "",
          });
          for (const post of result.items) {
            check();
            try {
              const detail = await collector.getNote(post);
              r.dataset.notes = dedupe([
                ...r.dataset.notes,
                ...detail.items.map((p) => ({
                  ...p,
                  kind: "creator-post" as const,
                })),
              ]);
            } catch {
              r.dataset.notes = dedupe([...r.dataset.notes, post]);
              r.errors.push("部分作者作品未取得正文或日期");
            }
            saveRun(r);
          }
          r.errors.push(...result.warnings);
          if (result.status !== "unavailable")
            r.creatorReadIds.push(n.creatorId);
        } catch (e) {
          r.errors.push(
            `${n.creatorId}: ${e instanceof Error ? e.message : "主页失败"}`,
          );
        }
        saveRun(r);
      }
    }
    data = applyCorrections(r.dataset, r.corrections);
    const newPosts = data.notes.filter(
      (n) => !relevance.some((x) => x.noteId === n.id),
    );
    for (let i = 0; i < newPosts.length; i += 15) {
      update("判断新增作者作品相关性", i, newPosts.length);
      relevance.push(
        ...(await ask("场景相关性", Rel, {
          product: r.product,
          notes: publicDataset({
            ...data,
            notes: newPosts.slice(i, i + 15),
            comments: [],
          }).notes,
          corrections: r.corrections,
        })),
      );
    }
    const Labels = AnalysisSchema.shape.labels;
    let labels: z.infer<typeof Labels> = [];
    const commentBudget = Math.min(
      180,
      Math.max(
        0,
        Math.floor(
          (Number(process.env.MODEL_MAX_CALLS || 24) - r.calls - 4) / 2,
        ) * 30,
      ),
    );
    const buckets = [...new Set(data.comments.map((c) => c.noteId))].map((id) =>
      data.comments.filter((c) => c.noteId === id),
    );
    const selectedComments: typeof data.comments = [];
    for (
      let i = 0;
      selectedComments.length < commentBudget &&
      buckets.some((b) => b.length > i);
      i++
    )
      for (const bucket of buckets) {
        if (bucket[i] && selectedComments.length < commentBudget)
          selectedComments.push(bucket[i]);
      }
    if (selectedComments.length < data.comments.length) {
      r.errors.push(
        `模型分析抽样：采集 ${data.comments.length} 条评论，仅分析均衡抽取的 ${selectedComments.length} 条；其余原文保留`,
      );
      saveRun(r);
    }
    // Each batch includes its note and parent comment context to preserve thread targets.
    for (let i = 0; i < selectedComments.length; i += 30) {
      update("识别评论需求与目标", i, selectedComments.length);
      const chunk = selectedComments.slice(i, i + 30);
      const parents = data.comments.filter((c) =>
        chunk.some((x) => x.parentId === c.id),
      );
      labels.push(
        ...(await ask("评论多标签与目标对象", Labels, {
          product: r.product,
          comments: chunk,
          parents,
          notes: publicDataset({
            ...data,
            notes: data.notes.filter((n) =>
              chunk.some((c) => c.noteId === n.id),
            ),
            comments: [],
          }).notes,
          corrections: r.corrections,
        })),
      );
    }
    update("生成选题与达人建议");
    const input = publicDataset(data);
    const generated = await ask(
      "需求聚合、选题与达人建议",
      AnalysisSchema.omit({ labels: true, relevance: true }),
      {
        product: r.product,
        dataset: input,
        labels,
        relevance,
        corrections: r.corrections,
        rules:
          "不生成统计数字；所有卡片必须引用提供的证据ID；达人卡必须有本作者作品证据。报价永远未知。",
      },
    );
    // Prior stage labels are authoritative; provider cannot silently overwrite human targets.
    const final = { ...generated, labels, relevance };
    update("校验证据与商品版本");
    const result = validateAnalysis(
      final,
      data,
      r.product,
      (r.history.at(-1)?.analysisVersion || 0) + 1,
    );
    await semanticAudit(result, data);
    check();
    r.result = result;
    r.history.push(result);
    r.status = "complete";
    r.stage = "研究完成";
    r.done = r.total = 1;
    saveRun(r);
  } catch (e) {
    r = get<Run>("run", id) || r;
    r.status =
      e instanceof Error && e.message === "CANCELLED" ? "cancelled" : "failed";
    r.stage =
      r.status === "cancelled" ? "已取消，已完成数据保留" : "任务暂停，可重试";
    if (r.status === "failed")
      r.errors.push(e instanceof Error ? e.message : "任务失败");
    saveRun(r);
  }
  async function semanticAudit(
    result: ReturnType<typeof validateAnalysis>,
    data: Dataset,
  ) {
    update("复核引用与商品事实一致性");
    const Audit = z.object({
      topicIds: z.array(z.string()),
      creatorIds: z.array(z.string()),
      demandIds: z.array(z.string()),
      allowNotRecommended: z.boolean(),
      issues: z.array(z.string()),
    });
    const audit = await ask(
      "证据与事实一致性复核：仅返回有原文支持、性能事实可追溯且无虚构的建议ID。删除无依据声明、含糊对象购买信号、无证据报价/转化/粉丝画像；检查相反反馈并列保留",
      Audit,
      { product: r.product, result, dataset: publicDataset(data) },
    );
    const before = {
      topics: result.topics.length,
      creators: result.creators.length,
    };
    result.topics = result.topics.filter((x) => audit.topicIds.includes(x.id));
    result.creators = result.creators.filter((x) =>
      audit.creatorIds.includes(x.id),
    );
    result.demands = result.demands.filter((x) =>
      audit.demandIds.includes(x.id),
    );
    if (!audit.allowNotRecommended) result.notRecommended = null;
    result.warnings.push(...audit.issues);
    if (result.topics.length < 3)
      result.reasons.topics = `最终保留 ${result.topics.length} 条选题，未凑满 3 条。商品事实未知、相关证据不足或一致性复核未通过；复核前 ${before.topics} 条。`;
    if (result.creators.length < 5)
      result.reasons.creators = `最终保留 ${result.creators.length} 位达人，未凑满 5 位。作者作品相关性或证据不足；复核前 ${before.creators} 位。`;
  }
}
