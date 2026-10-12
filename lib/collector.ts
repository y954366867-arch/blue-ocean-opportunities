import type { Note, Comment, Provenance } from "./schema";
import { createHash } from "node:crypto";
import { get, save } from "./db";
import type { Timing } from "./schema";
export function metricEstimate(v: unknown): {
  value: number | null;
  mode: string;
} {
  const exact = metric(v);
  if (exact !== null) return { value: exact, mode: "exact" };
  const match = String(v ?? "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)(万|千|w|k)?(\+)?$/i);
  if (!match) return { value: null, mode: "unknown" };
  const factor = /万|w/i.test(match[2] || "")
    ? 10000
    : /千|k/i.test(match[2] || "")
      ? 1000
      : 1;
  return {
    value: Number(match[1]) * factor,
    mode: match[3] ? "lower-bound" : "approximate",
  };
}
export type Coverage<T> = {
  items: T[];
  collectedAt: string;
  source: Provenance["source"];
  pagination: {
    cursor: string | null;
    hasMore: boolean | null;
    supported: boolean;
  };
  coverage: string;
  warnings: string[];
  status: "ok" | "partial" | "unavailable";
};
type Raw = Record<string, any>;
export function metric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d[\d,]*$/.test(v))
    return Number(v.replaceAll(",", ""));
  return null;
}
export function normalizeNote(f: Raw, query = ""): Note {
  const n = f.noteCard || f.note || f;
  const id = String(f.id || n.noteId || n.id || "");
  const u = n.user || {};
  const m = n.interactInfo || {};
  return {
    contentType:
      n.type === "video" ? "video" : n.type === "normal" ? "image" : "unknown",
    typeSource:
      n.type === "video" || n.type === "normal"
        ? "upstream:type"
        : "unconfirmed",
    id: `xhs:n:${id}`,
    platformId: id,
    creatorId: String(u.userId || ""),
    creatorName: u.nickname || u.nickName || "未知作者",
    title: n.title || n.displayTitle || "",
    text: n.desc || "",
    publishedAt:
      n.time && Number.isFinite(new Date(n.time).getTime())
        ? new Date(n.time).toISOString()
        : null,
    metrics: {
      likes: metric(m.likedCount),
      favorites: metric(m.collectedCount),
      comments: metric(m.commentCount),
    },
    metricsRaw: {
      likes: m.likedCount == null ? null : String(m.likedCount),
      favorites: m.collectedCount == null ? null : String(m.collectedCount),
      comments: m.commentCount == null ? null : String(m.commentCount),
    },
    collectedAt: new Date().toISOString(),
    images: (n.imageList || [n.cover])
      .filter(Boolean)
      .map((x: Raw) => x.urlDefault || x.url || x.urlPre || "")
      .filter(Boolean),
    queries: query ? [query] : [],
    ref: { xsecToken: f.xsecToken || n.xsecToken || "" },
    kind: "candidate",
  };
}
export function normalizeComments(
  list: Raw[],
  noteId: string,
  parentId: string | null = null,
): Comment[] {
  return list.flatMap((c) => {
    const id = `xhs:c:${c.id}`;
    return [
      {
        id,
        platformId: String(c.id),
        noteId,
        parentId,
        userId: c.userInfo?.userId || null,
        text: c.content || "",
        target: null,
      },
      ...normalizeComments(c.subComments || [], noteId, id),
    ];
  });
}
function coverage<T>(
  items: T[],
  description: string,
  hasMore: boolean | null = null,
  warnings: string[] = [],
): Coverage<T> {
  return {
    items,
    collectedAt: new Date().toISOString(),
    source: "live",
    pagination: { cursor: null, hasMore, supported: false },
    coverage: description,
    warnings,
    status: warnings.length ? "partial" : "ok",
  };
}
export class Collector {
  private details = new Map<string, Raw>();
  constructor(
    private options: {
      signal?: AbortSignal;
      forceRefresh?: boolean;
      onTiming?: (t: Timing) => void;
      v2?: boolean;
      cacheOnly?: boolean;
      cacheVersion?: number;
    } = {},
  ) {}
  useCacheOnly() {
    this.options.cacheOnly = true;
  }
  hasCachedSearch(queries: string[]) {
    return queries.every((keyword) => {
      const key = createHash("sha256")
        .update(
          JSON.stringify({
            base: process.env.XHS_BASE_URL || "http://127.0.0.1:18060",
            path: "/api/v1/feeds/search",
            body: { keyword, filters: {} },
            version: this.options.cacheVersion || 2,
          }),
        )
        .digest("hex");
      const cached = get<{ at: number }>("collector-cache", key);
      return (
        cached &&
        Date.now() - cached.at <
          Number(process.env.XHS_METRIC_CACHE_MS || 20 * 60000)
      );
    });
  }
  async request(path: string, body?: unknown): Promise<Raw> {
    const start = Date.now();
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          base: process.env.XHS_BASE_URL || "http://127.0.0.1:18060",
          path,
          body,
          version: this.options.cacheVersion || 2,
        }),
      )
      .digest("hex");
    const cached = this.options.v2
      ? get<{ at: number; data: Raw }>("collector-cache", cacheKey)
      : null;
    const ttl = Number(
      path.includes("search")
        ? process.env.XHS_METRIC_CACHE_MS || 20 * 60000
        : process.env.XHS_BODY_CACHE_MS || 12 * 3600000,
    );
    const record = (status: string, count = 0, cacheHit = false) =>
      this.options.onTiming?.({
        name:
          path +
          (path.includes("detail")
            ? (body as Raw)?.load_all_comments
              ? ":comments"
              : ":body"
            : ""),
        start: new Date(start).toISOString(),
        end: new Date().toISOString(),
        ms: Date.now() - start,
        status,
        retries: 0,
        count,
        cacheHit,
      });
    if (
      !this.options.forceRefresh &&
      cached &&
      Date.now() - cached.at < ttl &&
      !path.includes("login")
    ) {
      record("ok", cached.data.feeds?.length || 1, true);
      return {
        ...cached.data,
        __collectedAt: new Date(cached.at).toISOString(),
      };
    }
    if (this.options.cacheOnly) {
      record("cache-missing");
      throw Error("缓存未覆盖此补充接口；登录后强制刷新可继续，已有结果保留");
    }
    const base = process.env.XHS_BASE_URL || "http://127.0.0.1:18060";
    const url = new URL(base);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw Error("采集服务必须使用本机地址");
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.XHS_AUTH_TOKEN
            ? { Authorization: `Bearer ${process.env.XHS_AUTH_TOKEN}` }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: this.options.signal
          ? AbortSignal.any([
              this.options.signal,
              AbortSignal.timeout(Number(process.env.XHS_TIMEOUT_MS || 70000)),
            ])
          : AbortSignal.timeout(120000),
      });
    } catch {
      record("timeout-or-network-error");
      throw Error("采集服务未响应，请检查服务启动、登录和网络");
    }
    if (!res.ok) {
      record(`http-${res.status}`);
      throw Error(`采集接口失败（HTTP ${res.status}）`);
    }
    const j = await res.json();
    if (j.success !== true) {
      record("provider-error");
      throw Error("采集接口返回失败");
    }
    record(
      "ok",
      path.includes("detail") && !(body as Raw)?.load_all_comments
        ? 1
        : j.data?.feeds?.length || j.data?.data?.comments?.list?.length || 1,
    );
    if (this.options.v2 && !path.includes("login"))
      save("collector-cache", cacheKey, { at: start, data: j.data });
    return { ...j.data, __collectedAt: new Date(start).toISOString() };
  }
  async loginStatus() {
    return this.request("/api/v1/login/status");
  }
  async searchNotes(query: string, filters: unknown = {}, cursor?: string) {
    if (cursor) throw Error("上游搜索不支持游标续读");
    const d = await this.request("/api/v1/feeds/search", {
      keyword: query,
      filters,
    });
    if (!Array.isArray(d.feeds)) throw Error("搜索响应字段不匹配");
    return coverage<Note>(
      d.feeds
        .filter((x: Raw) => x.id && x.noteCard)
        .map((x: Raw) => ({
          ...normalizeNote(x, query),
          collectedAt: d.__collectedAt,
        })),
      "上游本次搜索页；不支持游标分页",
      null,
      ["搜索页不代表全部命中"],
    );
  }
  async detail(n: Note, limit = 60, mode: "body" | "comments" = "comments") {
    if (!n.ref?.xsecToken)
      throw Error("缺少详情所需访问参数；请重新搜索或导入正文");
    const key = `${n.id}:${mode}:${limit}:v2`;
    if (!this.details.has(key)) {
      const d = await this.request("/api/v1/feeds/detail", {
        feed_id: n.platformId,
        xsec_token: n.ref.xsecToken,
        load_all_comments: mode === "comments",
        comment_config: {
          click_more_replies: !this.options.v2 && mode === "comments",
          max_replies_threshold: 20,
          max_comment_items: limit,
          scroll_speed: "normal",
        },
      });
      if (!d.data?.note) throw Error("详情响应字段不匹配");
      this.details.set(key, { ...d.data, __collectedAt: d.__collectedAt });
    }
    return this.details.get(key)!;
  }
  async getNote(n: Note) {
    const d = await this.detail(
      n,
      this.options.v2 ? 0 : 60,
      this.options.v2 ? "body" : "comments",
    );
    return coverage(
      [
        {
          ...normalizeNote({ note: d.note }),
          ref: n.ref,
          queries: n.queries,
          collectedAt: d.__collectedAt,
        },
      ],
      "详情页正文及原始互动快照",
    );
  }
  async getComments(n: Note, cursor?: string, limits = { maxItems: 60 }) {
    if (cursor) throw Error("上游详情接口不支持指定评论游标");
    const d = await this.detail(n, limits.maxItems);
    if (!Array.isArray(d.comments?.list))
      return {
        ...coverage<Comment>([], "评论字段缺失", null, [
          "无法判断是否没有评论",
        ]),
        status: "unavailable" as const,
      };
    const all = normalizeComments(d.comments.list, n.id);
    return coverage(
      all.slice(0, limits.maxItems),
      "顶层及已展开回复，最多 " +
        limits.maxItems +
        " 条；跳过回复数超过 20 的展开按钮",
      d.comments.hasMore ?? null,
      d.comments.hasMore || all.length > limits.maxItems
        ? ["评论截断，未覆盖全部线程"]
        : [],
    );
  }
  async getCreatorPosts(
    c: { id: string; xsecToken: string },
    cursor?: string,
    limits = { maxItems: 5 },
  ) {
    if (cursor) throw Error("上游主页不支持指定游标");
    if (!c.xsecToken) throw Error("作者主页访问参数缺失");
    const raw = await this.request("/api/v1/user/profile", {
      user_id: c.id,
      xsec_token: c.xsecToken,
      tab: "notes",
    });
    const d = raw.data || raw;
    if (!Array.isArray(d.feeds))
      return {
        ...coverage<Note>([], "仅取得主页信息", null, ["作品字段缺失"]),
        status: "unavailable" as const,
      };
    return coverage<Note>(
      d.feeds.slice(0, limits.maxItems).map((f: Raw) => ({
        ...normalizeNote(f),
        kind: "creator-post" as const,
      })),
      "主页首屏作品；发布时间未读到时不能认定为近期作品",
      null,
      ["主页作品非全量，需详情核对发布时间"],
    );
  }
}
