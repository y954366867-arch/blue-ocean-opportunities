"use client";
import { useEffect, useState } from "react";
import type { Product, Run, Correction } from "../../lib/schema";
type State = {
  product: Product | null;
  runs: Run[];
  messages: { role: string; text: string }[];
  modelConfigured: boolean;
  provider: string | null;
};
const blank: Product = {
  id: "current",
  version: 0,
  name: "",
  category: "",
  price: "",
  specs: "",
  sellingPoints: [],
  limits: "",
  budget: "未知",
  images: [],
};
export default function Home() {
  const [state, setState] = useState<State>({
    product: null,
    runs: [],
    messages: [],
    modelConfigured: false,
    provider: null,
  });
  const [draft, setDraft] = useState<Product>(blank);
  const [input, setInput] = useState("");
  const [queries, setQueries] = useState("");
  const [source, setSource] = useState<"live" | "import">("live");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<"topics" | "creators">("topics");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [login, setLogin] = useState("未检查");
  const [connectionBusy, setConnectionBusy] = useState<
    "status" | "qrcode" | null
  >(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [importInfo, setImportInfo] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [styleVersion, setStyleVersion] = useState<number | null>(null);
  const [pending, setPending] = useState<{
    action: string;
    correction?: Correction | null;
    text: string;
  } | null>(null);
  const run = state.runs.find((r) => r.id === selected) || state.runs[0];
  const result = version
    ? run?.history.find((r) => r.analysisVersion === version)
    : run?.result;
  const active = run && ["queued", "running"].includes(run.status);
  const querySeed = draft.styleDescription?.trim() || draft.name;
  const styleResult = styleVersion
    ? run?.v2History?.find((v) => v.analysisVersion === styleVersion) || run?.v2
    : run?.v2;
  async function refresh() {
    const r = await fetch("/api/state");
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    setState(j);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (state.product) setDraft(state.product);
  }, [state.product?.version]);
  async function act(path: string, body?: unknown) {
    setError("");
    setBusy(true);
    try {
      const r = await fetch(
        `/api/${path}`,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : undefined,
      );
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      await refresh();
      return j;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function checkConnection(action: "status" | "qrcode") {
    setConnectionBusy(action);
    setConnectionMessage(
      action === "status" ? "正在检查登录，请稍候…" : "正在获取二维码，请稍候…",
    );
    if (action === "qrcode") setQr("");
    try {
      const response = await fetch(`/api/connection/${action}`, {
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "连接失败");
      if (action === "status") {
        setLogin(data.is_logged_in ? "已登录" : "未登录");
        setConnectionMessage(
          data.is_logged_in
            ? "已登录，可以开始实时采集。"
            : "尚未登录，请获取二维码并扫码。",
        );
      } else if (data.is_logged_in) {
        setLogin("已登录");
        setConnectionMessage("当前已登录，无需扫码，可以开始实时采集。");
      } else if (typeof data.img === "string" && data.img) {
        setQr(
          data.img.startsWith("data:")
            ? data.img
            : `data:image/png;base64,${data.img}`,
        );
        setConnectionMessage("二维码已获取，请使用小红书扫码，再检查登录。");
      } else {
        throw Error("采集服务未返回二维码，请先检查登录状态后重试。");
      }
    } catch (e) {
      const failure = e as Error;
      setConnectionMessage(
        ["TimeoutError", "AbortError"].includes(failure.name)
          ? "等待超过 45 秒，请稍后重试，并检查采集服务与网络。"
          : failure.message,
      );
    } finally {
      setConnectionBusy(null);
    }
  }
  async function chat() {
    if (!input.trim()) return;
    const text = input;
    setInput("");
    const j = await act("chat", { text });
    if (j?.product)
      setDraft({
        ...j.product,
        id: state.product?.id || "current",
        version: state.product?.version || 0,
        images: draft.images,
      });
    if (j?.queries) setQueries(j.queries.join("\n"));
    if (j?.action && j.action !== "profile" && j.action !== "none")
      setPending({ action: j.action, correction: j.correction, text });
  }
  async function confirmAdjustment() {
    if (!pending) return;
    setVersion(null);
    if (pending.action === "preference" && run)
      await correction({ kind: "preference", text: pending.text });
    else if (pending.action === "correction" && pending.correction && run)
      await correction(pending.correction);
    else if (["budget", "facts"].includes(pending.action)) {
      const p = await act("product", {
        ...draft,
        sellingPoints: draft.sellingPoints.filter((x) => x.trim()),
      });
      if (p && run)
        await act("run/action", {
          id: run.id,
          action: "reanalyze",
          productUpdate: true,
        });
    } else if (pending.action === "search") {
      const j = await act("runs", {
        queries: (
          queries ||
          [querySeed, `${querySeed}穿搭`, `${querySeed}通勤`].join("\n")
        )
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
        source,
        forceRefresh,
      });
      if (j) setSelected(j.id);
    } else {
      setError("请在商品卡或证据侧栏确认具体修改对象");
      return;
    }
    setPending(null);
  }
  async function correction(c: Correction) {
    if (!run) return;
    setVersion(null);
    await act("correction", { id: run.id, correction: c });
  }
  async function upload(file: File) {
    if (file.size > 10_000_000) {
      setError("文件不能超过 10MB");
      return;
    }
    const j = await act("import", {
      text: await file.text(),
      format: file.name.toLowerCase().endsWith(".csv") ? "csv" : "json",
    });
    if (j) {
      setSource("import");
      setImportInfo(
        `${j.provenance.source === "sample" ? "演示样例" : "导入数据"} · ${j.noteCount} 笔记 / ${j.commentCount} 评论 · ${j.provenance.collectedAt}`,
      );
    }
  }
  async function images(files: FileList | null) {
    if (!files) return;
    const arr: string[] = [];
    for (const f of Array.from(files).slice(0, 3)) {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
        f.size > 2_000_000
      ) {
        setError("图片仅支持 JPG/PNG/WebP，每张不超过 2MB");
        return;
      }
      arr.push(
        await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(f);
        }),
      );
    }
    setDraft({ ...draft, images: arr });
  }
  const url = (id: string) =>
    `https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}`;
  return (
    <main>
      {pending && (
        <div className="adjustment">
          <span>
            待确认调整：{pending.text} · {pending.action}
          </span>
          <button disabled={busy || !!active} onClick={confirmAdjustment}>
            确认并更新建议
          </button>
          <button onClick={() => setPending(null)}>放弃</button>
        </div>
      )}
      <header>
        <a className="brand" href="/">
          白牌研究室 <span>BETA</span>
        </a>
        <span className="muted">从商品事实，到可追溯的内容建议</span>
        <span className={"pill " + (state.modelConfigured ? "green" : "")}>
          {state.modelConfigured ? state.provider : "等待模型配置"}
        </span>
      </header>
      <div className="workspace">
        <section className="chat">
          <div className="intro">
            <span className="eyebrow">小红书 · 商品推广研究</span>
            <h1>
              这个商品，
              <br />
              怎样被看见？
            </h1>
            <p>
              告诉我你在卖什么。我们会一起确认事实，研究真实笔记和评论，同时给出选题与达人建议。
            </p>
          </div>
          <div className="messages">
            <article className="message assistant">
              填写商品类型与风格即可开始，例如“韩式包包”。价格、规格、卖点和合作预算可选，推荐基于风格与真实互动。
            </article>
            {state.messages.map((m, i) => (
              <article key={i} className={"message " + m.role}>
                {m.text}
              </article>
            ))}
          </div>
          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如：卖桌面收纳盒，售价 29 元，尺寸 20×15×10cm，支持叠放；承重还没测过…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  chat();
                }
              }}
            />
            <button disabled={busy || !input.trim()} onClick={chat}>
              发送 ↑
            </button>
          </div>
          <small>
            模型未配置时可先编辑商品卡和连接数据。图片仅作为资料保存，本版不推断图片中的性能。
          </small>
          <details className="connection">
            <summary>数据连接与导入</summary>
            <p>小红书登录状态：{login}</p>
            <div className="actions">
              <button
                disabled={connectionBusy !== null}
                onClick={() => checkConnection("status")}
              >
                {connectionBusy === "status" ? "正在检查…" : "检查登录"}
              </button>
              <button
                disabled={connectionBusy !== null}
                onClick={() => checkConnection("qrcode")}
              >
                {connectionBusy === "qrcode" ? "正在获取…" : "获取登录二维码"}
              </button>
            </div>
            <p role="status" aria-live="polite">
              {connectionMessage}
            </p>
            {qr && (
              <div className="qr">
                <img src={qr} alt="请使用小红书扫码登录" />
                <p>
                  请使用小红书扫码，完成后点击检查登录。二维码过期可重新获取。
                </p>
              </div>
            )}
            <label className="file">
              导入 JSON / CSV
              <input
                type="file"
                accept=".json,.csv"
                onChange={(e) => {
                  if (e.target.files?.[0]) upload(e.target.files[0]);
                }}
              />
            </label>
            <small>
              {importInfo ||
                "导入需包含来源、采集时间和覆盖范围，格式见 README。"}
            </small>
          </details>
        </section>
        <section className="research">
          <div className="section-head">
            <h2>研究工作台</h2>
            <span>一次研究一个商品</span>
          </div>
          <details className="panel profile" open>
            <summary>
              01　确认风格档案与可选事实{" "}
              <span>版本 {state.product?.version || "待确认"}</span>
            </summary>
            <div className="fields">
              {[
                ["name", "商品名称"],
                ["category", "品类"],
                ["styleDescription", "风格描述 / 包型 / 配色 / 场景"],
                ["styleShape", "包型（可选）"],
                ["styleColors", "配色（可选，逗号分隔）"],
                ["visualTraits", "外观特征（可选）"],
                ["styleScenes", "希望覆盖的场景（可选）"],
                ["excludedStyles", "排除的风格（可选）"],
                ["price", "售价"],
                ["specs", "规格"],
                ["limits", "已知限制 / 未知事实"],
                ["budget", "达人合作预算"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={String(draft[key as keyof Product] || "")}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                    placeholder="不确定可写未知"
                  />
                </label>
              ))}
            </div>
            <label>
              有依据的卖点（每行一条，可留空）
              <textarea
                value={draft.sellingPoints.join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sellingPoints: e.target.value.split("\n"),
                  })
                }
              />
            </label>
            <div className="profile-footer">
              <label className="file">
                添加商品图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(e) => images(e.target.files)}
                />
              </label>
              <small>
                {draft.images.length
                  ? `${draft.images.length} 张资料图片`
                  : "未提供图片"}
              </small>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act("product", {
                    ...draft,
                    sellingPoints: draft.sellingPoints.filter((x) => x.trim()),
                  })
                }
              >
                确认风格资料
              </button>
            </div>
          </details>
          <details className="panel" open>
            <summary>
              02　查询计划 <span>最多 3 组 · 50 条候选 · 6 条深读</span>
            </summary>
            <textarea
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
              placeholder="每行一个商品词、场景词或痛点词。确认后开始研究。"
            />
            <div className="actions">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
              >
                <option value="live">实时小红书</option>
                <option value="import">已导入数据 / 样例</option>
              </select>
              <button
                className="primary"
                disabled={busy || !!active || !state.product}
                onClick={async () => {
                  setVersion(null);
                  const j = await act("runs", {
                    queries: (
                      queries ||
                      [querySeed, `${querySeed}穿搭`, `${querySeed}通勤`].join(
                        "\n",
                      )
                    )
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    source,
                    forceRefresh,
                  });
                  if (j) setSelected(j.id);
                }}
              >
                开始研究
              </button>
            </div>
            <label>
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
              />{" "}
              强制刷新采集（不复用缓存，耗时更长）
            </label>
          </details>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {state.runs.length > 0 && (
            <div className="run-select">
              <select
                value={run?.id || ""}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setVersion(null);
                  setEvidence([]);
                }}
              >
                {state.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.product.name} · v{r.product.version} ·{" "}
                    {new Date(r.createdAt).toLocaleString("zh-CN")} · {r.status}
                  </option>
                ))}
              </select>
            </div>
          )}
          {run && (
            <section className="panel result">
              <div className="section-head">
                <h2>{run.stage}</h2>
                <span className="pill">
                  {run.dataset.provenance.source === "live"
                    ? "实时采集"
                    : run.dataset.provenance.source === "sample"
                      ? "演示样例"
                      : "导入数据"}
                </span>
              </div>
              <p className="scope">
                采集 {run.dataset.notes.length} 条笔记 ·{" "}
                {run.dataset.comments.length} 条评论（
                {run.dataset.comments.filter((c) => c.text.trim()).length}{" "}
                条有文本） ·{" "}
                {new Date(run.dataset.provenance.collectedAt).toLocaleString(
                  "zh-CN",
                )}
                <br />
                {run.dataset.provenance.coverage}
                {result && <> · 模型标注 {result.labels.length} 条</>}
              </p>
              {active && (
                <>
                  <progress value={run.done} max={run.total || 1} />
                  <p>
                    {run.done} / {run.total || "待确认"}　
                    <button
                      onClick={() =>
                        act("run/action", { id: run.id, action: "cancel" })
                      }
                    >
                      取消研究
                    </button>
                  </p>
                </>
              )}
              {!active && (
                <div className="actions">
                  <button
                    onClick={() => {
                      setVersion(null);
                      act("run/action", { id: run.id, action: "retry" });
                    }}
                  >
                    重试未完成阶段
                  </button>
                  <button
                    onClick={() => {
                      setVersion(null);
                      act("run/action", {
                        id: run.id,
                        action: "reanalyze",
                        productUpdate: true,
                      });
                    }}
                  >
                    用当前商品重算
                  </button>
                  <a className="button" href={`/api/export?id=${run.id}`}>
                    导出 Markdown
                  </a>
                </div>
              )}
              {run.history.length > 0 && (
                <select
                  value={version || ""}
                  onChange={(e) =>
                    setVersion(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">当前结果</option>
                  {run.history.map((v) => (
                    <option key={v.analysisVersion} value={v.analysisVersion}>
                      历史分析 v{v.analysisVersion} · 商品 v{v.productVersion}
                    </option>
                  ))}
                </select>
              )}
              {run.engineVersion !== 2 && (
                <p className="muted">旧 SKU 模式历史结果，非 V2 风格验证。</p>
              )}
              {run.engineVersion === 2 && (
                <>
                  {!!run.v2History?.length && (
                    <select
                      value={styleVersion || ""}
                      onChange={(e) =>
                        setStyleVersion(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    >
                      <option value="">当前 V2 结果</option>
                      {run.v2History.map((v) => (
                        <option
                          key={v.analysisVersion}
                          value={v.analysisVersion}
                        >
                          V2 分析版本 {v.analysisVersion}
                        </option>
                      ))}
                    </select>
                  )}
                  <p>
                    风格档案：
                    {run.styleProfile?.styleTerms.join("；") ||
                      run.product.name}{" "}
                    · 基于文字，图片未分析
                  </p>
                  <p>
                    活跃执行 {Math.round((run.activeMs || 0) / 1000)} 秒 ·
                    首批正式参考{" "}
                    {run.firstResultMs === undefined
                      ? "尚未取得"
                      : `${Math.round(run.firstResultMs / 1000)} 秒`}
                  </p>
                  {styleResult && (
                    <>
                      <p className="scope">{styleResult.comparison}</p>
                      <h3>风格高热内容 · {styleResult.topics.length}</h3>
                      {styleResult.topics.map((t) => (
                        <article className="recommendation" key={t.id}>
                          <span className="pill">{t.kind}</span>
                          <h3>{t.name}</h3>
                          <blockquote>{t.title}</blockquote>
                          <p>为什么适合：{t.match}</p>
                          <p>
                            共同表达：
                            {t.kind === "高热参考"
                              ? `单篇参考：${t.angle}；仅本篇支持，不代表共同模式。`
                              : `共同文字主题：${t.name}；展示步骤为可借鉴草稿，视觉细节未分析。`}
                          </p>
                          <p>切入点：{t.angle}</p>
                          <ol>
                            {t.steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                          <p>证据强度：{t.strength}</p>
                          <p>待确认：{t.unknowns.join("；")}</p>
                          {t.evidenceIds.map((id) => {
                            const n = run.dataset.notes.find(
                              (n) => n.id === id,
                            );
                            return n ? (
                              <div key={id}>
                                <a
                                  href={`https://www.xiaohongshu.com/explore/${encodeURIComponent(n.platformId)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {n.title} · {n.creatorName} ↗
                                </a>
                                {n.images[0] && (
                                  <img
                                    src={n.images[0]}
                                    alt="代表笔记封面（未进行视觉分析）"
                                    style={{ maxWidth: 180, maxHeight: 180 }}
                                  />
                                )}
                                <p>
                                  点赞{" "}
                                  {n.metricsRaw?.likes ??
                                    n.metrics.likes ??
                                    "未知"}{" "}
                                  · 收藏{" "}
                                  {n.metricsRaw?.favorites ??
                                    n.metrics.favorites ??
                                    "未知"}{" "}
                                  · 评论{" "}
                                  {n.metricsRaw?.comments ??
                                    n.metrics.comments ??
                                    "未知"}
                                </p>
                                <small>
                                  发布 {n.publishedAt || "未知"} · 采集{" "}
                                  {n.collectedAt || "未知"}
                                </small>
                              </div>
                            ) : null;
                          })}
                          <button onClick={() => setEvidence(t.evidenceIds)}>
                            查看原文证据
                          </button>
                        </article>
                      ))}
                      {!styleResult.topics.length && (
                        <p>
                          当前未取得同时具备风格与高热证据的正式方向，不凑数。
                        </p>
                      )}
                      <h3>达人候选 · {styleResult.creators.length}</h3>
                      {styleResult.creators.map((c) => (
                        <article className="recommendation" key={c.id}>
                          <span className="pill">{c.status}</span>
                          <h3>
                            <a
                              href={`https://www.xiaohongshu.com/user/profile/${encodeURIComponent(c.id)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {c.name} ↗
                            </a>
                          </h3>
                          <p>文字风格适配：{c.reason}</p>
                          <p>
                            实际读取 {c.postCount} 条正文 · 日期覆盖{" "}
                            {c.dates.join("、") || "未知"}
                          </p>
                          <p>
                            报价与合作条件未知；单篇热门不代表稳定创作能力。
                          </p>
                          <button onClick={() => setEvidence(c.evidenceIds)}>
                            查看高热代表作品
                          </button>
                        </article>
                      ))}
                      <details>
                        <summary>待验证样本与风格判断</summary>
                        {styleResult.matches.map((m) => (
                          <p key={m.noteId}>
                            {
                              run.dataset.notes.find((n) => n.id === m.noteId)
                                ?.title
                            }{" "}
                            · {m.status} · {m.reason}
                          </p>
                        ))}
                        <p>
                          适配但未达到候选热度：{styleResult.waitingIds.length}{" "}
                          条
                        </p>
                      </details>
                      {styleResult.warnings.map((w) => (
                        <p key={w} className="muted">
                          {w}
                        </p>
                      ))}
                      {!!styleResult.commentInsights?.length && (
                        <details>
                          <summary>评论补充解释（不代表成交）</summary>
                          {styleResult.commentInsights.map((c) => (
                            <p key={c.commentId}>
                              {c.target} · {c.insight}
                            </p>
                          ))}
                        </details>
                      )}
                    </>
                  )}
                  <details>
                    <summary>接口与阶段计时</summary>
                    {run.timings?.map((t, i) => (
                      <p key={i}>
                        {t.name} · {(t.ms / 1000).toFixed(1)}秒 · {t.status} ·{" "}
                        {t.count}条 · {t.cacheHit ? "缓存命中" : "实际请求"}
                      </p>
                    ))}
                  </details>
                </>
              )}
              {result ? (
                <>
                  <div className="tabs">
                    <button
                      className={tab === "topics" ? "chosen" : ""}
                      onClick={() => setTab("topics")}
                    >
                      选题建议 <b>{result.topics.length}</b>
                    </button>
                    <button
                      className={tab === "creators" ? "chosen" : ""}
                      onClick={() => setTab("creators")}
                    >
                      达人建议 <b>{result.creators.length}</b>
                    </button>
                  </div>
                  {tab === "topics" ? (
                    <>
                      {result.topics.map((t, i) => (
                        <article className="recommendation" key={t.id}>
                          <span className="eyebrow">
                            选题 {String(i + 1).padStart(2, "0")} · AI 判断
                          </span>
                          <h3>{t.name}</h3>
                          <p>
                            {t.audience} · {t.scene}
                          </p>
                          <blockquote>{t.title}</blockquote>
                          <p>购买理由：{t.buyingReason}</p>
                          <p>切入点：{t.angle}</p>
                          <ol>
                            {t.steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                          <p>商品匹配：{t.match}</p>
                          <p>限制：{t.limitations}</p>
                          <p className="unknown">
                            待核实：{t.unknowns.join("；") || "无新增项"}
                          </p>
                          <button onClick={() => setEvidence(t.evidenceIds)}>
                            查看 {t.evidenceIds.length} 条观察证据 →
                          </button>
                        </article>
                      ))}
                      <p className="muted">{result.reasons.topics}</p>
                      {result.notRecommended && (
                        <p>
                          不建议方向：{result.notRecommended.direction} ·{" "}
                          {result.notRecommended.reason}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {result.creators.map((c) => (
                        <article className="recommendation" key={c.id}>
                          <span className="pill">{c.status}</span>
                          <h3>
                            <a
                              href={`https://www.xiaohongshu.com/user/profile/${encodeURIComponent(c.creatorId)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {c.name} ↗
                            </a>
                          </h3>
                          <p>实际分析 {c.postCount} 条作品</p>
                          <p>AI 判断：{c.reason}</p>
                          <p>不匹配因素：{c.mismatch}</p>
                          <p className="unknown">{c.unknowns.join("；")}</p>
                          <p>报价与合作条件：尚未核实</p>
                          <p>待问：{c.questions.join("；")}</p>
                          <div className="actions">
                            <button onClick={() => setEvidence(c.evidenceIds)}>
                              查看观察证据 →
                            </button>
                            <button
                              disabled={!!active}
                              onClick={() =>
                                correction({
                                  kind: "exclude-creator",
                                  id: c.creatorId,
                                })
                              }
                            >
                              排除账号并重算
                            </button>
                          </div>
                        </article>
                      ))}
                      <p className="muted">{result.reasons.creators}</p>
                    </>
                  )}
                  <details>
                    <summary>需求发现与样本内统计</summary>
                    {result.demands.map((d) => (
                      <article key={d.id}>
                        <h3>
                          {d.scene} · {d.problem}
                        </h3>
                        <p>
                          {d.concern} · 商品能否满足：{d.canMeet}
                        </p>
                        <p>
                          证据集内 {d.commentCount} 条评论 / {d.noteCount}{" "}
                          条笔记 / {d.userCount ?? "无法去重"} 位用户
                        </p>
                        <button onClick={() => setEvidence(d.evidenceIds)}>
                          代表原文
                        </button>
                      </article>
                    ))}
                  </details>
                  <p className="unknown">
                    互动只表示本次样本表现；不等于成交。合作价格和转化率尚未核实。
                  </p>
                </>
              ) : run.v2?.topics.length ? null : (
                <p className="empty">
                  {active
                    ? "正在读取与分析证据，完成后同时呈现选题和达人。"
                    : "尚无有效分析结果，已取得的数据仍保留。"}
                </p>
              )}
              <details>
                <summary>采集记录与缺失信息 ({run.errors.length})</summary>
                {[
                  ...new Set([
                    ...run.errors,
                    ...(result?.warnings || []),
                    ...(run.v2?.warnings || []),
                  ]),
                ].map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                <small>
                  模型调用保留预算 {run.calls}；阶段耗时及 token 用量已保存。
                </small>
              </details>
              <button
                className="text-button"
                onClick={() =>
                  setEvidence([
                    ...run.dataset.notes.map((n) => n.id),
                    ...run.dataset.comments.map((c) => c.id),
                  ])
                }
              >
                查看全部原始证据与人工纠正
              </button>
            </section>
          )}
        </section>
      </div>
      {evidence.length > 0 && run && (
        <aside className="evidence">
          <div className="section-head">
            <h2>观察证据</h2>
            <button onClick={() => setEvidence([])}>关闭 ×</button>
          </div>
          <small>原文属于采集数据。侧栏纠正会保留旧版本并重新分析。</small>
          {evidence.map((id) => {
            const n = run.dataset.notes.find((n) => n.id === id);
            const c = run.dataset.comments.find((c) => c.id === id);
            const parent =
              c && run.dataset.notes.find((n) => n.id === c.noteId);
            return (
              <article key={id}>
                <span className="eyebrow">
                  {n ? "笔记 / 作者作品" : "评论"} · {id}
                </span>
                <h3>{n?.title || parent?.title}</h3>
                <p className="original">
                  {n?.text || c?.text || "正文未取得，仅有搜索标题"}
                </p>
                {n && (
                  <small>
                    作者：{n.creatorName} · 发布时间：
                    {n.publishedAt || "未取得"}
                    <br />
                    点赞 {n.metrics.likes ?? "未知"} · 收藏{" "}
                    {n.metrics.favorites ?? "未知"} · 评论{" "}
                    {n.metrics.comments ?? "未知"}
                  </small>
                )}
                {c && (
                  <small>
                    父评论：{c.parentId || "顶层"} · 目标：
                    {c.target ||
                      result?.labels.find((l) => l.commentId === id)?.target ||
                      "未判断"}
                  </small>
                )}
                <div className="actions">
                  <a
                    href={url(n?.platformId || parent?.platformId || "")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开原始笔记 ↗
                  </a>
                  {n && (
                    <button
                      disabled={!!active}
                      onClick={() => correction({ kind: "exclude-note", id })}
                    >
                      不相关，排除并重算
                    </button>
                  )}
                  {c && (
                    <select
                      disabled={!!active}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value)
                          correction({
                            kind: "comment-target",
                            id,
                            target: e.target.value as
                              "product" | "other" | "unknown",
                          });
                      }}
                    >
                      <option value="">纠正评论目标…</option>
                      <option value="product">当前商品</option>
                      <option value="category">同品类商品</option>
                      <option value="content">整体穿搭或内容</option>
                      <option value="other">另一个商品</option>
                      <option value="unknown">无法判断</option>
                    </select>
                  )}
                </div>
              </article>
            );
          })}
        </aside>
      )}
    </main>
  );
}
