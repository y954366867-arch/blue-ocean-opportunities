import { parse } from "csv-parse/sync";
import { DatasetSchema, type Dataset } from "./schema";
import { dedupe } from "./validation";
export function parseImport(text: string, format: "json" | "csv"): Dataset {
  const raw =
    format === "json"
      ? JSON.parse(text)
      : (() => {
          const rows = parse(text, {
            columns: true,
            skip_empty_lines: true,
            bom: true,
          }) as Record<string, string>[];
          if (!rows.length) throw Error("CSV 为空");
          return {
            provenance: {
              source: "import",
              collectedAt: rows[0].collectedAt,
              coverage: rows[0].coverage,
            },
            notes: rows
              .filter((r) => r.type === "note")
              .map((r) => ({
                id: r.id,
                platformId: r.platformId,
                creatorId: r.creatorId || "",
                creatorName: r.creatorName || "未知作者",
                title: r.title || "",
                text: r.text || "",
                publishedAt: r.publishedAt || null,
                metrics: {
                  likes: r.likes ? Number(r.likes) : null,
                  favorites: r.favorites ? Number(r.favorites) : null,
                  comments: r.comments ? Number(r.comments) : null,
                },
                images: [],
                queries: [],
                kind: r.kind || "candidate",
              })),
            comments: rows
              .filter((r) => r.type === "comment")
              .map((r) => ({
                id: r.id,
                platformId: r.platformId || r.id,
                noteId: r.noteId,
                parentId: r.parentId || null,
                userId: r.userId || null,
                text: r.text || "",
                target: null,
              })),
          };
        })();
  const d = DatasetSchema.parse(raw);
  if (d.provenance.source === "live") d.provenance.source = "import";
  d.notes = dedupe(d.notes);
  const ids = new Set(d.notes.map((n) => n.id));
  d.comments = [...new Map(d.comments.map((c) => [c.id, c])).values()];
  if (d.comments.some((c) => !ids.has(c.noteId)))
    throw Error("评论引用了不存在的笔记");
  const cs = new Map(d.comments.map((c) => [c.id, c]));
  if (
    d.comments.some(
      (c) =>
        c.parentId &&
        (!cs.has(c.parentId) || cs.get(c.parentId)!.noteId !== c.noteId),
    )
  )
    throw Error("评论父子关系无效");
  for (const n of d.notes) {
    delete n.ref;
  }
  return d;
}
