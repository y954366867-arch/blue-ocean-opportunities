"use client";
import { useEffect, useRef, useState } from "react";
import type { CategoryRun, SelectionType, V4Note } from "../lib/category-v4";
type Cat = {
  id: string;
  name: string;
  children: string[];
  seedTerms: string[];
};
async function api(path: string, body?: unknown) {
  const res = await fetch(
    "/api/" + path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "请求失败");
  return data;
}
export default function Home() {
  const [cats, setCats] = useState<Cat[]>([]),
    [selection, setSelection] = useState<SelectionType>({
      categoryId: "bags",
      subcategory: "",
      style: "",
      scene: "",
      days: 60,
      maxFollowers: 10000,
      minLikes: 100,
      minComments: 20,
      preference: "comments",
    });
  const [run, setRun] = useState<CategoryRun | null>(null),
    [previous, setPrevious] = useState<CategoryRun | null>(null),
    [favorites, setFavorites] = useState<string[]>([]),
    [favoriteVideos, setFavoriteVideos] = useState<
      {
        note: V4Note;
        runId: string;
        reasons: string[];
        directionNames: string[];
      }[]
    >([]),
    [view, setView] = useState("directions"),
    [direction, setDirection] = useState(""),
    [sort, setSort] = useState("comments"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [comments, setComments] = useState<Record<string, any>>({});
  const [excludedQueries, setExcludedQueries] = useState<string[]>([]);
  const [queryEdits, setQueryEdits] = useState<Record<string, string>>({});
  const active = run?.status === "running";
  const resultCache = useRef(new Map<string, any>());
  const [loading, setLoading] = useState(true);
  const query = new URLSearchParams(
    Object.entries(selection).map(([k, v]) => [k, String(v)]),
  ).toString();
  useEffect(() => {
    api("categories")
      .then((d) => setCats(d.categories))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cached = resultCache.current.get(query);
    setRun(cached?.run || null);
    setPrevious(cached?.previous || null);
    setLoading(!cached);
    setDirection("");
    setError("");
    const load = () =>
      api("category/result?" + query)
        .then((d) => {
          if (!disposed) {
            resultCache.current.set(query, d);
            setRun(d.run);
            setPrevious(d.previous);
            setFavorites(d.favorites);
            setFavoriteVideos(d.favoriteVideos || []);
            setError("");
            setLoading(false);
            timer = setTimeout(load, d.run?.status === "running" ? 3000 : 15000);
          }
        })
        .catch((e) => {
          if (!disposed) {
            setError(e.message);
            setLoading(false);
            timer = setTimeout(load, 15000);
          }
        });
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [query]);
  const shown = run?.directions.length
    ? run
    : previous?.directions.length
      ? previous
      : run;
  const current = shown?.directions.find((d) => d.id === direction);
  const videos = (
    view === "favorites"
      ? favoriteVideos.map((f) => f.note)
      : shown?.notes || []
  )
    .filter((n) =>
      view === "favorites"
        ? favorites.includes(n.id)
        : (direction ? current?.noteIds || [] : shown?.hotIds || []).includes(
            n.id,
          ),
    )
    .sort((a, b) => {
      const number = (n: typeof a) => {
        const v = n.metricsRaw?.[sort as "likes"] ?? n.metrics[sort as "likes"];
        const m = String(v ?? "").match(/([\d.]+)(万|千|w|k)?/i);
        return m
          ? Number(m[1]) *
              (/万|w/i.test(m[2] || "")
                ? 10000
                : /千|k/i.test(m[2] || "")
                  ? 1000
                  : 1)
          : 0;
      };
      return number(b) - number(a);
    });
  const tags = (type: string) => [
    ...new Set(
      (run?.classifications || []).flatMap((c) =>
        c.labels.filter((l) => l.type === type).map((l) => l.value),
      ),
    ),
  ];
  async function start(
    force = false,
    continueBatch = false,
    mode = "discover",
  ) {
    setBusy(true);
    setError("");
    try {
      setRun(
        await api("category/start", {
          selection,
          force,
          continue: continueBatch,
          mode,
          excludedQueries,
          queryEdits: Object.entries(queryEdits)
            .filter(([original, query]) => original !== query)
            .map(([original, query]) => ({ original, query })),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function favorite(id: string) {
    try {
      await api("category/favorite", { id });
      setFavorites((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      const refreshed = await api("category/result?" + query);
      setFavoriteVideos(refreshed.favoriteVideos || []);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="brand">
          蓝海商机<span>小红书 · 类目洞察</span>
        </div>
        <nav>
          {[
            ["directions", "内容灵感"],
            ["videos", "参考视频"],
            ["favorites", "我的收藏"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={view === id ? "chosen" : ""}
              onClick={() => {
                setView(id);
                setDirection("");
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <p>
          洞察真实需求
          <br />
          发现潜力商机
        </p>
      </aside>
      <main className="workspace">
        <div className="topline">
          <div>
            <small>CONTENT EXPLORER</small>
            <h1>类目高热视频方向</h1>
            <p>先选择商品类目，再查看有证据的内容方向与代表视频。</p>
          </div>
        </div>
        <div className="categorynav">
          {cats.map((c) => (
            <button
              className={c.id === selection.categoryId ? "chosen" : ""}
              key={c.id}
              onClick={() =>
                setSelection({
                  ...selection,
                  categoryId: c.id as SelectionType["categoryId"],
                  subcategory: "",
                  style: "",
                  scene: "",
                })
              }
            >
              {c.name}
            </button>
          ))}
        </div>
        {error && <div className="notice">{error}</div>}
        {active && (
          <button
            onClick={() =>
              api("category/cancel", { id: run!.id })
                .then(() => setRun({ ...run!, status: "cancelled" }))
                .catch((e) => setError(e.message))
            }
          >
            取消采集
          </button>
        )}
        {!run && (
          <div className="empty">
            <p>{loading ? "正在读取已有内容…" : "当前筛选下暂无已有内容"}</p>
          </div>
        )}
        {view === "directions" && (
          <>
            <h2>
              内容灵感 <small>{shown?.directions.length || 0} 个</small>
            </h2>
            <p className="muted">
              看看这个类目可以拍什么主题，点击灵感查看相关视频。
            </p>
            <div className="directions">
              {shown?.directions.map((d) => (
                <article
                  className={
                    "direction " + (direction === d.id ? "selected" : "")
                  }
                  key={d.id}
                >
                  <div className="badge">
                    {d.noteIds.length > 1
                      ? "多条视频共同灵感"
                      : "单条创作参考 / 待聚合"}
                  </div>
                  <h3>
                    <button
                      onClick={() => (setDirection(d.id), setView("videos"))}
                    >
                      {d.name}
                    </button>
                  </h3>
                  {d.creative ? (
                    <>
                      <p><b>一句话核心</b> {d.creative.core}</p>
                      <p><b>怎么拍 <small>AI建议</small></b></p>
                      <ol>{d.creative.organization.map((tip,i)=><li key={i}>{tip}</li>)}</ol>
                      {(d.creative.interactionObservation || d.creative.interactionAdvice) && <div>
                        <b>互动切口</b>
                        {d.creative.interactionObservation && <p><small>文字观察</small> {d.creative.interactionObservation.claim}</p>}
                        {d.creative.interactionAdvice && <p><small>AI建议</small> {d.creative.interactionAdvice}</p>}
                      </div>}
                    </>
                  ) : (
                    <p className="muted">
                      参考视频已保留，创作总结待完成。
                    </p>
                  )}
                  <button
                    onClick={() => {
                      setDirection(d.id);
                      setView("videos");
                    }}
                  >
                    查看相关视频 →
                  </button>
                </article>
              ))}
            </div>
            {run && !shown?.directions.length && (
              <div className="empty">
                {active
                  ? "正在核验视频日期、类目相关性与热度，结果分阶段出现。"
                  : "当前筛选下暂无符合条件的内容灵感。"}
              </div>
            )}
          </>
        )}
        {view !== "directions" && (
          <>
            <div className="sectionline">
              <h2>
                {view === "favorites"
                  ? "我的收藏"
                  : current
                    ? current.name + " · 代表视频"
                    : "热门参考视频"}
              </h2>
              {direction && (
                <button onClick={() => setDirection("")}>显示全部</button>
              )}
            </div>
            <p className="muted">
              观看真实热门视频，参考标题、内容和表现形式。
            </p>
            <div className="videos">
              {videos.map((n) => (
                <article className="video" key={n.id}>
                  {n.images[0] ? (
                    <img
                      src={n.images[0]}
                      alt={n.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="noimage">封面未取得</div>
                  )}
                  <div className="videobody">
                    <div className="badge">
                      小红书 · 已确认视频 ·{" "}
                      {new Date(n.publishedAt!).toLocaleDateString("zh-CN")}
                    </div>
                    <h3>{n.title}</h3>
                    <p>{n.creatorName}</p>
                    {n.followers && (
                      <p>作者粉丝：{n.followers.raw ?? "待核实"}</p>
                    )}

                    <div className="metrics">
                      点赞 {n.metricsRaw?.likes ?? n.metrics.likes ?? "未知"} ·
                      收藏{" "}
                      {n.metricsRaw?.favorites ?? n.metrics.favorites ?? "未知"}{" "}
                      · 评论{" "}
                      {n.metricsRaw?.comments ?? n.metrics.comments ?? "未知"}
                    </div>
                    <p className="muted">
                      {(view === "favorites"
                        ? favoriteVideos.find((f) => f.note.id === n.id)
                            ?.reasons
                        : shown?.heatReasons[n.id]
                      )?.join("；")}
                    </p>
                    <p>
                      所属方向：
                      {(view === "favorites"
                        ? favoriteVideos
                            .find((f) => f.note.id === n.id)
                            ?.directionNames.join("、")
                        : shown?.directions
                            .filter((d) => d.noteIds.includes(n.id))
                            .map((d) => d.name)
                            .join("、")) || "单条视频灵感"}
                    </p>
                    <div className="actions">
                      <button onClick={() => favorite(n.id)}>
                        {favorites.includes(n.id) ? "已收藏" : "收藏"}
                      </button>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={
                          "https://www.xiaohongshu.com/explore/" +
                          encodeURIComponent(n.platformId)
                        }
                      >
                        查看原视频 ↗
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {run && !videos.length && (
              <p className="empty">当前筛选下没有符合条件的视频。</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
