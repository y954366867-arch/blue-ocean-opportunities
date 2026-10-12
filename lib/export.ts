import type { Run } from "./schema";
import { noteUrl, creatorUrl } from "./public";
export function markdown(r: Run) {
  const out = [
    `# ${r.product.name} · 商品推广研究`,
    `商品版本 ${r.product.version} | 来源 ${r.dataset.provenance.source} | 采集时间 ${r.dataset.provenance.collectedAt}`,
    `本次 ${r.dataset.notes.length} 条笔记，${r.dataset.comments.length} 条评论。覆盖：${r.dataset.provenance.coverage}`,
    `状态：${r.stage}`,
  ];
  if (r.engineVersion === 2) {
    out.push(
      "## V2 风格高热研究",
      `风格：${r.styleProfile?.styleTerms.join("；") || r.product.name}；仅文字，未理解图片。`,
      `活跃执行 ${r.activeMs || 0}ms；首批结果 ${r.firstResultMs ?? "未取得"}ms。`,
      r.v2?.comparison || "尚无正式结果",
    );
    for (const t of r.v2?.topics || [])
      out.push(
        `### ${t.kind}：${t.name}`,
        `为什么适合：${t.match}\n表达共性：${t.commonPattern}\n证据强度：${t.strength}`,
        t.title,
        t.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
        `待确认：${t.unknowns.join("；")}`,
        ...t.evidenceIds.map((id) => {
          const n = r.dataset.notes.find((n) => n.id === id);
          return n
            ? `[${n.title}](${noteUrl(n.platformId)}) · ${n.creatorName}\n点赞/收藏/评论：${JSON.stringify(n.metricsRaw || n.metrics)}\n发布：${n.publishedAt || "未知"}；采集：${n.collectedAt}\n${n.text}`
            : "";
        }),
      );
    out.push("## 达人候选");
    for (const c of r.v2?.creators || [])
      out.push(
        `[${c.name}](${creatorUrl(c.id)}) · ${c.status}`,
        c.reason,
        `实际正文 ${c.postCount} 条；日期 ${c.dates.join("、") || "未知"}；报价未知；单篇不证明稳定能力。`,
        `证据 ${c.evidenceIds.join("、")}`,
      );
    out.push(
      "## 计时",
      ...(r.timings || []).map(
        (t) =>
          `${t.name}：${t.ms}ms ${t.status}；缓存${t.cacheHit}；数量${t.count}`,
      ),
      "## 缺失信息",
      ...r.errors,
      ...(r.v2?.warnings || []),
    );
    return out.join("\n\n");
  }
  if (!r.result) {
    out.push("尚无有效模型分析结果。");
    return out.join("\n\n");
  }
  out.push("## 选题建议");
  for (const t of r.result.topics)
    out.push(
      `### ${t.name}`,
      `AI 判断：${t.audience} / ${t.scene} / ${t.buyingReason}`,
      `标题草稿：${t.title}\n切入点：${t.angle}`,
      t.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      `匹配：${t.match}\n限制：${t.limitations}\n未知：${t.unknowns.join("；")}`,
      `证据：${t.evidenceIds.join(", ")}`,
    );
  out.push(r.result.reasons.topics, "## 达人建议");
  for (const c of r.result.creators)
    out.push(
      `### [${c.name}](${creatorUrl(c.creatorId)}) · ${c.status}`,
      `实际分析作品 ${c.postCount} 条。AI 判断：${c.reason}\n不匹配：${c.mismatch}`,
      `报价：尚未核实\n未知：${c.unknowns.join("；")}\n待问：${c.questions.join("；")}\n证据：${c.evidenceIds.join(", ")}`,
    );
  out.push(r.result.reasons.creators, "## 原始证据");
  const ids = new Set([
    ...r.result.topics.flatMap((t) => t.evidenceIds),
    ...r.result.creators.flatMap((c) => c.evidenceIds),
    ...r.result.demands.flatMap((d) => d.evidenceIds),
  ]);
  for (const id of ids) {
    const n = r.dataset.notes.find((n) => n.id === id);
    const c = r.dataset.comments.find((c) => c.id === id);
    if (n)
      out.push(`### ${id}\n[${n.title}](${noteUrl(n.platformId)})\n${n.text}`);
    if (c) {
      const parent = r.dataset.notes.find((n) => n.id === c.noteId);
      out.push(
        `### ${id}\n${c.text}\n${parent ? `[来源笔记](${noteUrl(parent.platformId)})` : ""}`,
      );
    }
  }
  out.push("## 局限", ...r.errors, ...r.result.warnings);
  return out.join("\n\n");
}
