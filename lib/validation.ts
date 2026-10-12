import type {
  Analysis,
  Dataset,
  Product,
  Correction,
  ValidAnalysis,
  Note,
} from "./schema";
export function dedupe(notes: Note[]) {
  const m = new Map<string, Note>();
  for (const n of notes) {
    const old = m.get(n.id);
    m.set(
      n.id,
      old
        ? {
            ...old,
            ...n,
            queries: [...new Set([...old.queries, ...n.queries])],
          }
        : n,
    );
  }
  return [...m.values()];
}
// V2 style cards survive a missing performance fact: rewrite the claim, keep valid style evidence.
export function qualifyPerformance(text: string) {
  if (
    !/(真皮|防水|耐用|耐磨|轻量|轻便|大容量|抗刮)/.test(text) ||
    /(待确认|待验证|实测|是否|未知|不宣称|不承诺|原笔记|需确认)/.test(text)
  )
    return text;
  return `外观与搭配展示（涉及性能的草稿内容需实测确认，不作性能承诺）：${text}`;
}
export function applyCorrections(
  d: Dataset,
  corrections: Correction[],
): Dataset {
  let notes = d.notes,
    comments = d.comments;
  for (const c of corrections) {
    if (c.kind === "exclude-note") notes = notes.filter((n) => n.id !== c.id);
    if (c.kind === "exclude-creator")
      notes = notes.filter((n) => n.creatorId !== c.id);
    if (c.kind === "comment-target")
      comments = comments.map((x) =>
        x.id === c.id ? { ...x, target: c.target } : x,
      );
  }
  const ids = new Set(notes.map((n) => n.id));
  return { ...d, notes, comments: comments.filter((c) => ids.has(c.noteId)) };
}
export function shortlist(notes: Note[], limit = 12) {
  const ids = new Set<string>();
  for (const key of ["likes", "favorites", "comments"] as const) {
    for (const n of [...notes]
      .filter((n) => n.metrics[key] !== null)
      .sort((a, b) => b.metrics[key]! - a.metrics[key]!)
      .slice(0, Math.ceil(limit / 3)))
      ids.add(n.id);
  }
  for (const n of notes) if (ids.size < limit) ids.add(n.id);
  return notes.filter((n) => ids.has(n.id)).slice(0, limit);
}
export function validateAnalysis(
  a: Analysis,
  d: Dataset,
  p: Product,
  version: number,
): ValidAnalysis {
  const warnings: string[] = [];
  const notes = new Map(d.notes.map((n) => [n.id, n]));
  const comments = new Map(d.comments.map((c) => [c.id, c]));
  const all = new Set([...notes.keys(), ...comments.keys()]);
  const usable = new Set(
    a.relevance
      .filter(
        (r) => notes.has(r.noteId) && ["direct", "adjacent"].includes(r.status),
      )
      .map((r) => r.noteId),
  );
  const labels = a.labels
    .filter((l) => comments.has(l.commentId))
    .map((l) => {
      const c = comments.get(l.commentId)!;
      return { ...l, target: (c.target || l.target) as typeof l.target };
    });
  const labelMap = new Map(labels.map((l) => [l.commentId, l]));
  const valid = (ids: string[]) =>
    ids.length > 0 &&
    ids.every(
      (id) =>
        all.has(id) &&
        (notes.has(id)
          ? usable.has(id)
          : usable.has(comments.get(id)!.noteId) &&
            labelMap.get(id)?.target === "product"),
    );
  const topics = a.topics.filter(
    (t) =>
      valid(t.evidenceIds) &&
      t.factIndices.every((i) => i < p.sellingPoints.length),
  );
  if (topics.length !== a.topics.length)
    warnings.push("移除了证据无效、目标不明或商品事实引用无效的选题");
  const demands = a.demands
    .filter((t) => valid(t.evidenceIds))
    .map((t) => {
      const cs = t.evidenceIds
        .filter((id) => comments.has(id))
        .map((id) => comments.get(id)!);
      return {
        ...t,
        commentCount: new Set(cs.map((c) => c.id)).size,
        userCount: cs.some((c) => !c.userId)
          ? null
          : new Set(cs.map((c) => c.userId)).size,
        noteCount: new Set(
          t.evidenceIds.map((id) =>
            notes.has(id) ? id : comments.get(id)!.noteId,
          ),
        ).size,
      };
    });
  const creators = a.creators
    .filter(
      (c) =>
        d.notes.some((n) => n.creatorId === c.creatorId) &&
        valid(c.evidenceIds) &&
        c.evidenceIds.some(
          (id) => notes.has(id) && notes.get(id)!.creatorId === c.creatorId,
        ),
    )
    .map((c) => {
      const posts = d.notes.filter(
        (n) => n.creatorId === c.creatorId && usable.has(n.id),
      );
      const dated = posts.filter(
        (n) =>
          n.text &&
          n.publishedAt &&
          Date.now() - Date.parse(n.publishedAt) >= 0 &&
          Date.now() - Date.parse(n.publishedAt) < 90 * 86400000,
      );
      return {
        ...c,
        name: posts[0]?.creatorName || "未知作者",
        postCount: posts.filter((n) => n.text).length,
        status:
          dated.length < 3 && c.status !== "暂不推荐"
            ? ("信息不足" as const)
            : c.status,
        quote: null,
        quoteSource: null,
        unknowns: [
          ...c.unknowns,
          "报价、合作条件及受众画像尚未核实",
          ...(dated.length < 3 ? ["缺少近期至少 3 条相关作品详情"] : []),
        ],
      };
    });
  if (creators.length !== a.creators.length)
    warnings.push("移除了作者或作者作品证据无效的达人建议");
  return {
    ...a,
    relevance: a.relevance.filter((r) => notes.has(r.noteId)),
    labels,
    topics,
    demands,
    creators,
    reasons: {
      topics:
        topics.length < 3
          ? a.reasons.topics || "可用证据不足，未凑满 3 条"
          : a.reasons.topics,
      creators:
        creators.length < 5
          ? a.reasons.creators || "可用作者作品不足，未凑满 5 位"
          : a.reasons.creators,
    },
    notRecommended:
      a.notRecommended && valid(a.notRecommended.evidenceIds)
        ? a.notRecommended
        : null,
    productVersion: p.version,
    analysisVersion: version,
    warnings,
  };
}
