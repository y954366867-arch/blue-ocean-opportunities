import { mkdirSync, writeFileSync } from "node:fs";
import { Collector } from "../lib/collector";
import { publicDataset } from "../lib/public";
import { DatasetSchema } from "../lib/schema";
import { dedupe } from "../lib/validation";
const collector = new Collector();
const at = new Date().toISOString();
const checks: Record<string, unknown> = {
  at,
  keyword: "家居收纳",
  status: "pending",
  checks: [],
};
const records = checks.checks as unknown[];
mkdirSync("reports", { recursive: true });
function save() {
  writeFileSync(
    "reports/data-verification.json",
    JSON.stringify(checks, null, 2),
  );
}
try {
  const login = await collector.loginStatus();
  records.push({ stage: "login", isLoggedIn: login.is_logged_in });
  if (!login.is_logged_in) {
    checks.status = "blocked-login";
    save();
    console.log("BLOCKED: 请先在 Bot 连接设置中扫码登录；报告已保存。");
    process.exitCode = 2;
  } else {
    const s = await collector.searchNotes("家居收纳");
    console.log("真实搜索取得 " + s.items.length + " 条候选，开始最多三条深读");
    records.push({
      stage: "search",
      count: s.items.length,
      coverage: s.coverage,
      pagination: s.pagination,
      hasRequiredRef: s.items.map((n) => ({
        id: !!n.platformId,
        token: !!n.ref?.xsecToken,
      })),
    });
    const notes = [],
      comments = [];
    for (const n of s.items.slice(0, 3)) {
      console.log("验证笔记详情、评论与作者作品");
      try {
        const detail = await collector.getNote(n);
        const cs = await collector.getComments(n);
        notes.push(...detail.items);
        comments.push(...cs.items);
        records.push({
          stage: "detail-comments",
          noteId: n.id,
          text: !!detail.items[0]?.text,
          images: detail.items[0]?.images.length,
          publishedAt: detail.items[0]?.publishedAt,
          metrics: detail.items[0]?.metrics,
          metricsRaw: detail.items[0]?.metricsRaw,
          comments: cs.items.length,
          users: cs.items.filter((c) => c.userId).length,
          childComments: cs.items.filter((c) => c.parentId).length,
          status: cs.status,
          coverage: cs.coverage,
          pagination: cs.pagination,
          warnings: cs.warnings,
        });
        try {
          const ps = await collector.getCreatorPosts({
            id: n.creatorId,
            xsecToken: n.ref?.xsecToken || "",
          });
          records.push({
            stage: "creator",
            creatorId: n.creatorId,
            count: ps.items.length,
            status: ps.status,
            coverage: ps.coverage,
            warnings: ps.warnings,
          });
          for (const post of ps.items.slice(0, 1)) {
            try {
              const detail = await collector.getNote(post);
              notes.push(
                ...detail.items.map((n) => ({
                  ...n,
                  kind: "creator-post" as const,
                })),
              );
              records.push({
                stage: "creator-post-detail",
                creatorId: n.creatorId,
                noteId: post.id,
                text: !!detail.items[0]?.text,
                publishedAt: detail.items[0]?.publishedAt,
              });
            } catch (e) {
              records.push({
                stage: "creator-post-detail",
                status: "failed",
                error: (e as Error).message,
              });
            }
          }
        } catch (e) {
          records.push({
            stage: "creator",
            status: "failed",
            error: (e as Error).message,
          });
        }
      } catch (e) {
        records.push({
          stage: "detail",
          status: "failed",
          error: (e as Error).message,
        });
      }
    }
    checks.status = "collected-needs-human-review";
    save();
    mkdirSync("data", { recursive: true });
    writeFileSync(
      "data/verified-live.json",
      JSON.stringify(
        DatasetSchema.parse({
          provenance: {
            source: "live",
            collectedAt: at,
            coverage:
              "验证用中性关键词首屏，3条候选深读及每作者最多1条作品详情；评论每笔记最多60条",
          },
          notes: dedupe(notes),
          comments,
        }),
        null,
        2,
      ),
    );
    const safe = publicDataset({
      provenance: {
        source: "live",
        collectedAt: at,
        coverage: "中性关键词首屏，最多三条深读，仅证明有限可用性",
      },
      notes,
      comments,
    });
    // Pseudonymize all identifiers/text personal details for the verification sample.
    const idMap = new Map<string, string>();
    const anon = (s: string) => {
      if (!idMap.has(s)) idMap.set(s, `anon-${idMap.size + 1}`);
      return idMap.get(s)!;
    };
    safe.notes = safe.notes.map((n) => ({
      ...n,
      id: anon(n.id),
      platformId: anon(n.platformId),
      creatorId: anon(n.creatorId),
      creatorName: "脱敏作者",
      images: [],
      text: n.text
        .replace(/\d{7,}/g, "[脱敏数字]")
        .replace(/@[\S]+/g, "[脱敏提及]"),
    }));
    safe.comments = safe.comments.map((c) => ({
      ...c,
      id: anon(c.id),
      platformId: anon(c.platformId),
      noteId: anon(c.noteId),
      parentId: c.parentId ? anon(c.parentId) : null,
      userId: c.userId ? anon(c.userId) : null,
      text: c.text
        .replace(/\d{7,}/g, "[脱敏数字]")
        .replace(/@[\S]+/g, "[脱敏提及]"),
    }));
    writeFileSync(
      "reports/redacted-real-sample.json",
      JSON.stringify(safe, null, 2),
    );
    console.log(
      "采集已记录，仍需人工复核；查看 reports/data-verification.json。",
    );
  }
} catch (e) {
  checks.status = "blocked-service";
  checks.error = (e as Error).message;
  save();
  console.log(checks.error);
  process.exitCode = 2;
}
