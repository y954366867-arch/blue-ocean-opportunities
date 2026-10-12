import type { Note, Product, StyleProfile } from "./schema";
import { metricEstimate } from "./collector";
export function styleProfile(p: Product): StyleProfile {
  return {
    category: p.category || p.name,
    styleTerms: [p.name, p.styleDescription || ""].filter(Boolean),
    shape: p.styleShape || "待确认",
    colors: p.styleColors ? p.styleColors.split(/[，,、]/).filter(Boolean) : [],
    visualTraits: p.visualTraits ? [p.visualTraits] : [],
    scenes: p.styleScenes ? p.styleScenes.split(/[，,、]/).filter(Boolean) : [],
    excludedStyles: p.excludedStyles ? [p.excludedStyles] : [],
    referenceImages: p.images.map((_, i) => `product-image:${i + 1}`),
    source: "user-text",
    confirmedByUser: true,
    version: p.version,
  };
}
export function rankHot(notes: Note[]) {
  const topK = Number(process.env.HOT_TOP_K || 3);
  const floors = {
    likes: Number(process.env.HOT_MIN_LIKES || 1000),
    favorites: Number(process.env.HOT_MIN_FAVORITES || 300),
    comments: Number(process.env.HOT_MIN_COMMENTS || 100),
  };
  const ids = new Set<string>();
  const dated = notes.filter(
    (n) => n.publishedAt && Number.isFinite(Date.parse(n.publishedAt)),
  );
  const age = (n: Note) =>
    n.publishedAt ? (Date.now() - Date.parse(n.publishedAt)) / 86400000 : NaN;
  const cohort = (n: Note) => {
    const days = age(n);
    return !Number.isFinite(days) || days < 0
      ? "未知时长"
      : days <= 7
        ? "0–7天"
        : days <= 30
          ? "8–30天"
          : days <= 90
            ? "31–90天"
            : "90天以上";
  };
  const groups =
    dated.length >= 10
      ? [...new Set(notes.map(cohort))].map((label) =>
          notes.filter((n) => cohort(n) === label),
        )
      : [notes];
  const calibrated = dated.length >= 10 && groups.some((g) => g.length >= 4);
  for (const key of ["likes", "favorites", "comments"] as const) {
    for (const group of calibrated ? groups : [notes])
      group
        .map((n) => ({
          n,
          estimate: metricEstimate(n.metricsRaw?.[key] ?? n.metrics[key]),
        }))
        .filter(
          (x) => x.estimate.value !== null && x.estimate.value >= floors[key],
        )
        .sort((a, b) => b.estimate.value! - a.estimate.value!)
        .slice(0, topK)
        .forEach((x) => ids.add(x.n.id));
  }
  return {
    hot: notes.filter((n) => ids.has(n.id)),
    waiting: notes.filter((n) => !ids.has(n.id)),
    comparison: `本次文字风格适配样本 ${notes.length} 条；点赞、收藏、评论分别前 ${topK} 名并集，且至少一项达到配置候选下限（${floors.likes}/${floors.favorites}/${floors.comments}）。${calibrated ? "按0–7/8–30/31–90/90天以上分组比较；未知时长单列，不计算不稳定分位数。" : "日期/样本不足，未校准发布时长。"}非全平台标准，不相加总分。显示值万/千按近似量或下界排序，原文保留。评论高不等于正面口碑。`,
  };
}
