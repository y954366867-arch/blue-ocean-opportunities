import { z } from "zod";
import { get, saveRun, save } from "./db";
import { createHash } from "node:crypto";
import { Collector } from "./collector";
import { model } from "./model";
import {
  StyleMatchSchema,
  StyleCardsSchema,
  StyleAuditSchema,
  type Run,
  type Note,
  type Timing,
} from "./schema";
import { styleProfile, rankHot } from "./style";
import { applyCorrections, dedupe, qualifyPerformance } from "./validation";
import { publicDataset } from "./public";

export async function executeV2(id: string, analysisOnly: boolean) {
  let r = get<Run>("run", id)!;
  const start = Date.now();
  const controller = new AbortController();
  const budget = Number(process.env.RESEARCH_BUDGET_MS || 300000);
  const timer = setTimeout(() => controller.abort("budget"), budget);
  const poll = setInterval(() => {
    if (get<Run>("run", id)?.cancelRequested) controller.abort("cancel");
  }, 500);
  const timing = (t: Timing) => {
    (r.timings ??= []).push(t);
    saveRun(r);
  };
  const collector = new Collector({
    v2: true,
    signal: controller.signal,
    forceRefresh: r.forceRefresh,
    onTiming: timing,
  });
  const check = () => {
    if (controller.signal.aborted)
      throw Error(
        controller.signal.reason === "cancel"
          ? "CANCELLED"
          : "达到五分钟时间预算，已保存部分结果",
      );
  };
  const stage = (s: string) => {
    check();
    r.stage = s;
    saveRun(r);
  };
  const ask = async <T>(name: string, schema: z.ZodType<T>, input: unknown) => {
    check();
    const at = Date.now();
    const usageStart = r.usage.length;
    let status = "ok";
    let count = 0;
    if (r.calls >= Number(process.env.MODEL_MAX_CALLS || 24))
      throw Error("达到模型调用预算");
    r.calls += 2;
    try {
      const output = await model(
        name,
        schema,
        input,
        (ms, tokens) => {
          r.usage.push({ stage: name, ms, tokens });
        },
        controller.signal,
      );
      count = Array.isArray(output)
        ? output.length
        : (output as { topics?: unknown[] })?.topics?.length || 0;
      return output;
    } catch (e) {
      status = "failed";
      throw e;
    } finally {
      timing({
        name,
        start: new Date(at).toISOString(),
        end: new Date().toISOString(),
        ms: Date.now() - at,
        status: controller.signal.aborted ? "aborted" : status,
        retries: Math.max(0, r.usage.length - usageStart - 1),
        count,
        cacheHit: false,
      });
    }
  };
  const safeNotes = (notes: Note[]) =>
    publicDataset({ ...r.dataset, notes, comments: [] }).notes;
  const classify = async (notes: Note[]) => {
    const key = (n: Note) =>
      createHash("sha256")
        .update(
          JSON.stringify({
            style: r.styleProfile,
            id: n.id,
            title: n.title,
            text: n.text,
            model: process.env.MODEL_NAME,
            v: 3,
          }),
        )
        .digest("hex");
    const matches: z.infer<typeof StyleMatchSchema>[] = [];
    const missing: Note[] = [];
    for (const n of notes) {
      const cached = get<{
        at: number;
        match: z.infer<typeof StyleMatchSchema>;
      }>("style-match-cache", key(n));
      if (cached && Date.now() - cached.at < 12 * 3600000)
        matches.push(cached.match);
      else missing.push(n);
    }
    if (missing.length) {
      const judged = await ask("V2 文字风格适配", z.array(StyleMatchSchema), {
        style: r.styleProfile,
        notes: safeNotes(missing),
        instruction:
          "按用户实际输入的风格判断，不要求SKU价格或尺寸相同。用户仅提供韩式包包时，标题/正文明确韩系、韩代、韩国包品牌等同品类文字可认定文字风格适配（视觉待确认）；品牌讨论、选购形式不是风格冲突，不能因不是穿搭而降级。摘要缺乏韩式依据且无正文才标信息不足。无韩系依据的通用包不自动适配。存在用户排除风格或品类冲突必须排除。不要虚构包型/配色观察。",
      });
      for (const m of judged) {
        const n = missing.find((n) => n.id === m.noteId);
        if (n) {
          save("style-match-cache", key(n), { at: Date.now(), match: m });
          matches.push(m);
        }
      }
    }
    return matches;
  };
  async function publish() {
    stage("V2 生成风格高热方向与达人候选");
    const data = applyCorrections(r.dataset, r.corrections);
    const deep = data.notes.filter(
      (n) => r.deepReadIds.includes(n.id) && n.text.trim(),
    );
    if (!deep.length) return;
    const matches = await classify(deep);
    const appropriate = deep.filter((n) =>
      matches.some((m) => m.noteId === n.id && m.status === "适配"),
    );
    const ranked = rankHot(appropriate);
    const generated = ranked.hot.length
      ? await ask(
          "V2 内容方向：只用hot笔记引用ID，突出穿搭构图展示，禁用未知性能声明",
          StyleCardsSchema,
          {
            style: r.styleProfile,
            notes: safeNotes(ranked.hot),
            matches,
            preferences: r.corrections.filter((c) => c.kind === "preference"),
            rules:
              "价格不参与判断。无需评论和卖点。至少2条笔记归纳共同模式；只有1条则明确单条参考。写3至5个展示步骤。不肯定宣称真皮、防水、耐用、轻量、大容量或适合电脑尺寸。",
          },
        )
      : { topics: [] };
    // Targeted audit sees only cards and their own source paragraphs; no SKU comparison or comment gate.
    const audit = generated.topics.length
      ? await ask(
          "V2 逐卡改写审计：去掉无依据性能声明，保持正文支持的风格表达；引用不得改变，不要求同款SKU",
          StyleAuditSchema,
          {
            cards: generated.topics,
            style: r.styleProfile,
            notes: safeNotes(ranked.hot),
            instruction:
              "逐卡、逐篇检查是否真正支持该卡共同表达模式。supports中逐项返回topicId/noteId/逐字原文quote/supportsPattern。quote只允许从该篇标题或正文逐字引用。只有品牌列表不能支持容量/身高具体模式；只支持一个模式实例时保留单篇参考，移除不支持的引用。去掉无依据性能声明，不要求商家SKU。",
          },
        )
      : { ...generated, supports: [] };
    const hotIds = new Set(ranked.hot.map((n) => n.id));
    const supportedCards = audit.topics.map((t) => ({
      ...t,
      evidenceIds: t.evidenceIds.filter((id) =>
        audit.supports.some(
          (s) =>
            s.topicId === t.id &&
            s.noteId === id &&
            s.supportsPattern &&
            s.quote.trim().length > 0 &&
            ranked.hot.some(
              (n) => n.id === id && (n.title + "\n" + n.text).includes(s.quote),
            ),
        ),
      ),
    }));
    const topics = supportedCards
      .filter((t) => t.evidenceIds.length)
      .filter((t) => t.evidenceIds.every((e) => hotIds.has(e)))
      .map((t) => {
        const unique = [...new Set(t.evidenceIds)];
        const authors = new Set(
          deep.filter((n) => unique.includes(n.id)).map((n) => n.creatorId),
        );
        return {
          ...t,
          title: qualifyPerformance(t.title),
          angle: qualifyPerformance(t.angle),
          commonPattern:
            unique.length === 1
              ? `单篇正文参考：${qualifyPerformance(t.angle)}；仅本篇支持，不代表共同模式或趋势。`
              : `本次${unique.length}篇正文支持的共同文字主题为“${t.name}”；具体构图、配色和视觉搭配尚未分析，展示步骤为可借鉴草稿。`,
          steps: t.steps.map(qualifyPerformance),
          evidenceIds: unique,
          kind:
            unique.length >= 2 ? ("内容方向" as const) : ("高热参考" as const),
          strength:
            unique.length >= 2
              ? `${unique.length}条笔记/${authors.size}位作者；${authors.size < 2 ? "同作者，非独立验证" : "跨作者重复表达"}`
              : "单篇参考，不证明趋势或稳定能力",
        };
      });
    const creators = [...new Set(ranked.hot.map((n) => n.creatorId))]
      .filter(Boolean)
      .slice(0, 5)
      .map((cid) => {
        const posts = data.notes.filter((n) => n.creatorId === cid);
        const relevant = posts.filter((n) =>
          matches.some((m) => m.noteId === n.id && m.status === "适配"),
        );
        const representatives = ranked.hot.filter((n) => n.creatorId === cid);
        return {
          id: cid,
          name: representatives[0].creatorName,
          evidenceIds: representatives.map((n) => n.id),
          reason:
            matches.find((m) => m.noteId === representatives[0].id)?.reason ||
            "",
          status:
            relevant.length >= 2
              ? "已补充多作品文字风格验证"
              : "有高热相关作品的候选",
          postCount: posts.filter(
            (n) => n.text.trim() && r.deepReadIds.includes(n.id),
          ).length,
          dates: posts
            .filter((n) => n.text.trim() && r.deepReadIds.includes(n.id))
            .map((n) => n.publishedAt)
            .filter((d): d is string => !!d),
        };
      });
    r.v2 = {
      version: 2,
      analysisVersion: (r.v2?.analysisVersion || 0) + 1,
      matches,
      topics,
      creators,
      hotIds: [...hotIds],
      waitingIds: ranked.waiting.map((n) => n.id),
      sampleSize: appropriate.length,
      comparison: ranked.comparison,
      warnings: [
        "仅分析文字，商品与笔记图片均未进行视觉理解；关键包型、配色及视觉适配待确认。",
        "无报价、成交与持续创作能力结论。",
      ],
    };
    (r.v2History ??= []).push(structuredClone(r.v2));
    if (topics.length && r.firstResultMs === undefined)
      r.firstResultMs = Date.now() - start;
    saveRun(r);
  }
  try {
    r.status = "running";
    r.styleProfile ??= styleProfile(r.product);
    saveRun(r);
    if (!analysisOnly && r.dataset.provenance.source === "live") {
      if (!r.forceRefresh && collector.hasCachedSearch(r.queries.slice(0, 3))) {
        collector.useCacheOnly();
        stage("V2 复用本地缓存，无需登录");
        r.errors.push(
          "本次只复用仍有效的本地缓存，未重新采集；未缓存的补充资料需登录后强制刷新。",
        );
      } else {
        stage("V2 检查登录");
        if (!(await collector.loginStatus()).is_logged_in)
          throw Error("请先扫码登录小红书");
      }
      for (const query of r.queries.slice(0, 3)) {
        if (r.collectedQueries.includes(query)) continue;
        stage(`V2 搜索：${query}`);
        try {
          const found = await collector.searchNotes(query);
          r.dataset.notes = dedupe([...r.dataset.notes, ...found.items]).slice(
            0,
            50,
          );
          r.collectedQueries.push(query);
        } catch (e) {
          r.errors.push(`${query}：${(e as Error).message}`);
        }
        saveRun(r);
        // First search can yield a real reference before remaining queries.
        if (r.dataset.notes.length && !r.v2) await deepen(1);
        if (Date.now() - start > budget * 0.55) break;
      }
      await deepen(6);
    } else {
      r.deepReadIds = r.dataset.notes
        .filter((n) => n.text.trim())
        .map((n) => n.id);
    }
    await publish();
    if (!analysisOnly && r.v2 && Date.now() - start < budget * 0.8) {
      for (const creator of r.v2.creators.slice(0, 2)) {
        if (r.creatorReadIds.includes(creator.id)) continue;
        stage("V2 补充达人主页及代表正文（不加载评论）");
        const n = r.dataset.notes.find((n) =>
          creator.evidenceIds.includes(n.id),
        )!;
        try {
          const posts = await collector.getCreatorPosts({
            id: creator.id,
            xsecToken: n.ref?.xsecToken || "",
          });
          r.dataset.notes = dedupe([...r.dataset.notes, ...posts.items]);
          for (const post of posts.items.slice(0, 1)) {
            if (Date.now() - start > budget * 0.85) break;
            const detail = await collector.getNote(post);
            r.dataset.notes = dedupe([...r.dataset.notes, ...detail.items]);
            r.deepReadIds.push(post.id);
          }
          r.creatorReadIds.push(creator.id);
        } catch (e) {
          r.errors.push(`达人补充：${(e as Error).message}`);
        }
        saveRun(r);
      }
      if (Date.now() - start < budget * 0.85) await publish();
      for (const n of r.dataset.notes
        .filter((n) => r.v2?.hotIds.includes(n.id))
        .slice(0, 2)) {
        if (Date.now() - start > budget * 0.87) break;
        stage("V2 补充代表评论（最多12条，不展开回复）");
        try {
          const comments = await collector.getComments(n, undefined, {
            maxItems: 12,
          });
          r.dataset.comments = [
            ...new Map(
              [...r.dataset.comments, ...comments.items].map((c) => [c.id, c]),
            ).values(),
          ];
        } catch (e) {
          r.errors.push(`评论补充：${(e as Error).message}`);
        }
        saveRun(r);
      }
    }
    if (
      r.v2 &&
      r.dataset.comments.length &&
      Date.now() - start < budget * 0.9
    ) {
      stage("V2 评论补充解释（不作为推荐门槛）");
      try {
        const comments = r.dataset.comments.slice(0, 24);
        const insights = await ask(
          "V2 评论解释：对象为同品类、其他商品、整体穿搭或不明确；求链接不指向SKU，不推断成交",
          z.array(
            z.object({
              commentId: z.string(),
              target: z.enum([
                "同品类商品",
                "其他商品",
                "整体穿搭或内容",
                "不明确",
              ]),
              insight: z.string(),
            }),
          ),
          {
            comments,
            notes: safeNotes(
              r.dataset.notes.filter((n) =>
                comments.some((c) => c.noteId === n.id),
              ),
            ),
          },
        );
        r.v2.commentInsights = insights.filter((x) =>
          comments.some((c) => c.id === x.commentId),
        );
      } catch (e) {
        r.errors.push(`补充解释：${(e as Error).message}`);
      }
    }
    r.status = "complete";
    r.stage = r.v2?.topics.length
      ? "V2 基础研究完成"
      : "V2 研究完成，适配或高热证据不足";
  } catch (e) {
    r.cancelRequested = get<Run>("run", id)?.cancelRequested || false;
    r.status = r.cancelRequested ? "cancelled" : "failed";
    r.stage = r.v2 ? "V2 已保存部分结果，可重试补充" : "V2 暂停，可重试";
    r.errors.push((e as Error).message);
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    if (controller.signal.reason === "budget") {
      r.errors.push(
        "达到本轮五分钟时间预算，已保存结果和缺失项；可手动重试补充。",
      );
      if (r.v2?.topics.length) r.stage = "V2 时间预算已到，已保存已有结果";
    }
    r.activeMs = (r.activeMs || 0) + Date.now() - start;
    saveRun(r);
  }
  async function deepen(limit: number) {
    stage("V2 摘要风格初筛与互动候选缩减");
    const data = applyCorrections(r.dataset, r.corrections);
    const matches = await classify(
      data.notes.filter((n) => n.kind === "candidate"),
    );
    r.pendingStyleMatches = matches;
    saveRun(r);
    // An inconclusive search summary is a reason to read its body, never a formal recommendation.
    const candidates = data.notes.filter(
      (n) =>
        matches.some((m) => m.noteId === n.id && m.status !== "不适配") &&
        (matches.some((m) => m.noteId === n.id && m.status === "适配") ||
          /包|bag/i.test(n.title)),
    );
    const hot = rankHot(candidates).hot;
    for (const n of hot.slice(0, limit)) {
      if (r.deepReadIds.includes(n.id)) continue;
      stage("V2 读取候选正文（不加载评论）");
      try {
        const detail = await collector.getNote(n);
        r.dataset.notes = dedupe([...r.dataset.notes, ...detail.items]);
        r.deepReadIds.push(n.id);
      } catch (e) {
        r.errors.push(`${n.id}：${(e as Error).message}`);
      }
      saveRun(r);
    }
    await publish();
  }
}
