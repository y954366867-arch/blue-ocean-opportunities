import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  get,
  list,
  message,
  messages,
  product,
  save,
  saveRun,
} from "../../../lib/db";
import {
  ProductSchema,
  CorrectionSchema,
  type Run,
  type Dataset,
} from "../../../lib/schema";
import { createRun, launch, runs } from "../../../lib/engine";
import { model, modelConfigured } from "../../../lib/model";
import { Collector } from "../../../lib/collector";
import { publicRun } from "../../../lib/public";
import { parseImport } from "../../../lib/import";
import {
  categories,
  capabilities,
  Selection,
  latestCategory,
  categoryRuns,
  publicCategory,
  startCategory,
  cancelCategory,
  filteredCategory,
  selectionKey,
  correctLabels,
  type CategoryRun,
} from "../../../lib/category-v4";
import { markdown } from "../../../lib/export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const QuerySchema = z.array(z.string().trim().min(1).max(100)).min(1).max(3);
function local(req: NextRequest) {
  const host = req.headers.get("host") || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
    throw Error("仅允许本机访问");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== host) throw Error("拒绝跨站请求");
}
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    local(req);
    const { path } = await ctx.params;
    const key = path.join("/");
    const collector = new Collector();
    if (req.method === "GET") {
      if (key === "categories")
        return NextResponse.json({
          // 用户移除无合格视频的入口；保留内部类目配置及已有缓存。
          categories: categories.filter(c => !["shoes", "food-drinks", "baby-kids", "pet-supplies"].includes(c.id)),
          capabilities,
        });
      if (key === "category/result") {
        const selection = Selection.parse({
          categoryId: req.nextUrl.searchParams.get("categoryId") || "bags",
          subcategory: req.nextUrl.searchParams.get("subcategory") || "",
          style: req.nextUrl.searchParams.get("style") || "",
          scene: req.nextUrl.searchParams.get("scene") || "",
          days: Number(req.nextUrl.searchParams.get("days") || 60),
          maxFollowers: Number(
            req.nextUrl.searchParams.get("maxFollowers") || 10000,
          ),
          minLikes: Number(req.nextUrl.searchParams.get("minLikes") || 100),
          minComments: Number(
            req.nextUrl.searchParams.get("minComments") || 20,
          ),
          preference: req.nextUrl.searchParams.get("preference") || "comments",
        });
        const recent = latestCategory(selection);
        const previous = categoryRuns().find(
          (r) =>
            r.key === selectionKey(selection) &&
            r.id !== recent?.id &&
            r.directions.length,
        );
        const favoriteVideos = list<{
          id: string;
          active: boolean;
          runId: string;
        }>("category-favorite")
          .filter((x) => x.active)
          .flatMap((f) => {
            const origin = get<CategoryRun>("category-run", f.runId);
            const note =
              origin && publicCategory(origin).notes.find((n) => n.id === f.id);
            return note && origin
              ? [
                  {
                    note,
                    runId: origin.id,
                    reasons: origin.heatReasons[f.id] || [],
                    directionNames: origin.directions
                      .filter((d) => d.noteIds.includes(f.id))
                      .map((d) => d.name),
                  },
                ]
              : [];
          });
        return NextResponse.json({
          favoriteVideos,
          run: recent
            ? publicCategory(filteredCategory(recent, selection))
            : null,
          previous: previous
            ? publicCategory(filteredCategory(previous, selection))
            : null,
          favorites: list<{ id: string; active: boolean }>("category-favorite")
            .filter((x) => x.active)
            .map((x) => x.id),
        });
      }
      if (
        key === "category/progress" ||
        key === "category/export" ||
        key === "category/direction"
      ) {
        const r = get<CategoryRun>(
          "category-run",
          req.nextUrl.searchParams.get("id") || "",
        );
        if (!r) throw Error("任务不存在");
        if (key === "category/direction")
          return NextResponse.json(
            r.directions.find(
              (d) => d.id === req.nextUrl.searchParams.get("directionId"),
            ) || null,
          );
        if (key === "category/export")
          return new NextResponse(JSON.stringify(publicCategory(r), null, 2), {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition":
                'attachment; filename="category-research.json"',
            },
          });
        return NextResponse.json(publicCategory(r));
      }
      if (key === "state")
        return NextResponse.json({
          product: product(),
          runs: runs().map(publicRun),
          messages: messages(),
          modelConfigured: modelConfigured(),
          provider: process.env.MODEL_NAME || null,
        });
      if (key === "connection/status")
        return NextResponse.json(await collector.loginStatus());
      if (key === "connection/qrcode")
        return NextResponse.json(
          await collector.request("/api/v1/login/qrcode"),
        );
      if (key === "export") {
        const r = get<Run>("run", req.nextUrl.searchParams.get("id") || "");
        if (!r) throw Error("研究不存在");
        return new NextResponse(markdown(r), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": 'attachment; filename="research.md"',
          },
        });
      }
    }
    if (req.method === "POST") {
      if (Number(req.headers.get("content-length") || 0) > 12_000_000)
        return NextResponse.json({ error: "上传超过 12MB" }, { status: 413 });
      const text = await req.text();
      if (text.length > 12_000_000) throw Error("请求过大");
      const body = JSON.parse(text);
      if (key === "category/start")
        return NextResponse.json(
          publicCategory(
            startCategory(
              body.selection,
              body.force === true,
              body.continue === true,
              z
                .array(z.string().max(30))
                .max(30)
                .default([])
                .parse(body.excludedQueries),
              z
                .array(
                  z.object({
                    original: z.string().max(30),
                    query: z.string().trim().min(2).max(30),
                  }),
                )
                .max(10)
                .default([])
                .parse(body.queryEdits),
              z
                .enum(["discover", "analyze-existing"])
                .default("discover")
                .parse(body.mode),
            ),
          ),
        );
      if (key === "category/labels") {
        const b = z
          .object({
            runId: z.string(),
            noteId: z.string(),
            labels: z
              .array(
                z.object({
                  value: z.string().trim().min(1).max(24),
                  type: z.enum(["shape", "style", "scene", "format"]),
                }),
              )
              .max(8),
          })
          .parse(body);
        return NextResponse.json(
          publicCategory(correctLabels(b.runId, b.noteId, b.labels)),
        );
      }
      if (key === "category/cancel") {
        cancelCategory(z.string().parse(body.id));
        return NextResponse.json({ ok: true });
      }
      if (key === "category/favorite") {
        const id = z.string().min(1).max(200).parse(body.id);
        const existing = get<{ id: string; active: boolean }>(
          "category-favorite",
          id,
        );
        const origin = list<CategoryRun>("category-run").find((r) =>
          r.hotIds?.includes(id),
        );
        if (!origin) throw Error("只能收藏已验证的高热视频");
        save("category-favorite", id, {
          id,
          active: !existing?.active,
          runId: origin.id,
        });
        return NextResponse.json({ ok: true });
      }
      if (key === "category/comments") {
        if (
          categoryRuns().some(
            (r) =>
              r.status === "running" &&
              Date.now() - Date.parse(r.createdAt) < r.budgetMs + 10000,
          )
        )
          throw Error("基础采集进行中，请结束后读取评论，避免共享浏览器冲突");
        const r = get<CategoryRun>(
          "category-run",
          z.string().parse(body.runId),
        );
        const n = r?.notes.find(
          (n) => n.id === body.noteId && r.hotIds.includes(n.id),
        );
        if (!n || !r) throw Error("请选择有效高热视频");
        const comments = await new Collector({ v2: true }).getComments(
          n,
          undefined,
          { maxItems: 15 },
        );
        const labels = comments.items.map((c) => ({
          ...c,
          classification:
            /(?:包|背包|托特).*(?:链接|哪买|哪里买|求)|(?:求|问).*(?:包.*链接|包.*哪买)/.test(
              c.text,
            )
              ? "明确询问包"
              : /链接|哪买|哪里买/.test(c.text)
                ? "不明确或其他商品"
                : /搭配|包型|通勤/.test(c.text)
                  ? "搭配/包型/场景"
                  : "其他",
        }));
        const explicit = labels.filter(
          (c) => c.classification === "明确询问包",
        );
        const result = {
          ...comments,
          items: labels,
          explicitCount: explicit.length,
          userCount: explicit.every((c) => c.userId)
            ? new Set(explicit.map((c) => c.userId)).size
            : null,
          warning:
            "按关键词保守分类，需人工复核；评论意向不代表成交；最多15条，不展开全部回复",
        };
        return NextResponse.json(result);
      }
      if (key === "product") {
        const parsed = ProductSchema.parse(body);
        const old = product();
        const p = {
          ...parsed,
          id: old?.id || "current",
          version: (old?.version || 0) + 1,
        };
        save("product", "current", p);
        return NextResponse.json(p);
      }
      if (key === "chat") {
        const b = z
          .object({ text: z.string().trim().min(1).max(6000) })
          .parse(body);
        message("user", b.text);
        const old = product();
        const ChatSchema = z.object({
          reply: z.string(),
          product: ProductSchema.omit({
            id: true,
            version: true,
            images: true,
          }).nullable(),
          queries: QuerySchema.nullable(),
          correction: CorrectionSchema.nullable(),
          action: z.enum([
            "profile",
            "preference",
            "budget",
            "facts",
            "search",
            "correction",
            "none",
          ]),
        });
        if (!modelConfigured()) {
          const reply =
            "模型尚未配置，当前不能识别自然语言或生成建议。你可以先编辑商品卡、导入数据和连接小红书；配置模型后继续对话。";
          message("assistant", reply);
          return NextResponse.json({ reply });
        }
        const result = await model(
          "V2 对话：提取品类和用户风格到name/category/styleDescription，未知可空。仅韩式包包也可以开始，不追问价格佣金库存性能。查询2至3组风格词，不加价格或SKU。图片未分析。保留用户已有商品事实，允许修改风格。",
          ChatSchema,
          {
            text: b.text,
            product: old,
            recentMessages: messages(),
            research: runs()[0] ? publicRun(runs()[0]) : null,
          },
        );
        message("assistant", result.reply);
        return NextResponse.json(result);
      }
      if (key === "import") {
        const b = z
          .object({
            text: z.string().max(12_000_000),
            format: z.enum(["json", "csv"]),
          })
          .parse(body);
        const d = parseImport(b.text, b.format);
        save("dataset", "import", d);
        return NextResponse.json({
          provenance: d.provenance,
          noteCount: d.notes.length,
          commentCount: d.comments.length,
        });
      }
      if (key === "runs") {
        const b = z
          .object({
            queries: QuerySchema,
            source: z.enum(["live", "import"]),
            forceRefresh: z.boolean().optional(),
          })
          .parse(body);
        const p = product();
        if (!p?.name.trim())
          throw Error("请先填写商品类型或风格，例如韩式包包；价格和卖点可留空");
        const dataset =
          b.source === "import" ? get<Dataset>("dataset", "import") : undefined;
        if (b.source === "import" && !dataset) throw Error("请先导入 JSON/CSV");
        if (runs().some((r) => ["running", "queued"].includes(r.status)))
          throw Error("请等待或取消当前研究");
        return NextResponse.json(
          publicRun(
            createRun(
              p,
              b.queries,
              dataset || undefined,
              2,
              b.forceRefresh || false,
            ),
          ),
        );
      }
      if (key === "run/action") {
        const b = z
          .object({
            id: z.string(),
            action: z.enum(["cancel", "retry", "reanalyze"]),
            productUpdate: z.boolean().optional(),
          })
          .parse(body);
        const r = get<Run>("run", b.id);
        if (!r) throw Error("研究不存在");
        if (b.action === "cancel") {
          r.cancelRequested = true;
          saveRun(r);
          return NextResponse.json({ ok: true });
        }
        if (["running", "queued"].includes(r.status))
          throw Error("任务运行中，请先取消");
        let mode: "full" | "budget" = "full";
        if (b.productUpdate) {
          const p = product();
          if (!p) throw Error("商品不存在");
          const facts = (x: typeof p) =>
            JSON.stringify({
              name: x.name,
              category: x.category,
              price: x.price,
              specs: x.specs,
              sellingPoints: x.sellingPoints,
              limits: x.limits,
              images: x.images,
            });
          if (facts(p) === facts(r.product) && p.budget !== r.product.budget)
            mode = "budget";
          r.product = p;
          if (r.engineVersion === 2) r.styleProfile = undefined;
        }
        r.cancelRequested = false;
        r.result = null;
        saveRun(r);
        launch(r.id, b.action === "reanalyze", mode);
        return NextResponse.json({ ok: true });
      }
      if (key === "correction") {
        const b = z
          .object({ id: z.string(), correction: CorrectionSchema })
          .parse(body);
        const r = get<Run>("run", b.id);
        if (!r) throw Error("研究不存在");
        if (["running", "queued"].includes(r.status))
          throw Error("请先取消研究再纠正");
        const c = b.correction;
        if (
          c.kind === "exclude-note" &&
          !r.dataset.notes.some((n) => n.id === c.id)
        )
          throw Error("笔记不存在");
        if (
          c.kind === "comment-target" &&
          !r.dataset.comments.some((n) => n.id === c.id)
        )
          throw Error("评论不存在");
        if (
          c.kind === "exclude-creator" &&
          !r.dataset.notes.some((n) => n.creatorId === c.id)
        )
          throw Error("作者不存在");
        r.corrections.push(c);
        r.result = null;
        r.cancelRequested = false;
        saveRun(r);
        launch(r.id, true, c.kind === "preference" ? "preference" : "full");
        return NextResponse.json({ ok: true });
      }
    }
    return NextResponse.json({ error: "接口不存在" }, { status: 404 });
  } catch (e) {
    const error =
      e instanceof z.ZodError
        ? "输入或数据结构不符合要求"
        : e instanceof SyntaxError
          ? "JSON 格式无效"
          : e instanceof Error
            ? e.message
            : "请求失败";
    return NextResponse.json({ error }, { status: 400 });
  }
}
export const GET = handler;
export const POST = handler;
