# 蓝海商机

基于小红书真实标题、正文和已取得评论的类目内容灵感看板。采用 Next.js、TypeScript 与 SQLite，展示内容灵感、关联参考视频及收藏。商家只选择商品类目；页面已移除筛选排序区域、采集按钮及分析状态折叠栏。

## 运行

需要 Node.js 24+。

```powershell
npm ci
npm run build
npm start
```

访问 http://127.0.0.1:3000/ 。本项目仅允许本机访问。

**本仓库只包含源码、测试和规则说明，不包含环境文件、Cookie、采集数据、本地数据库、缓存或运行报告。新克隆的项目不会显示原电脑上的采集结果。**

如需真实采集，在项目根目录自行创建 `.env.local`，配置本机小红书采集服务地址 `XHS_BASE_URL`（默认 `http://127.0.0.1:18060`），以及兼容 OpenAI 接口的 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`。数据库默认保存于 `data/bot.sqlite`。配置与凭据不得提交到 Git。

小红书采集服务需单独安装和登录；搜索触发安全验证时必须由账号本人正常扫码完成。看板浏览已有缓存不发起搜索。模型仅分析文字，不分析视频画面或音频。

## 采集与分析

- 宽词发现 → 从真实内容提炼扩搜词 → 扩搜验证。
- 候选为点赞≥100或评论≥20；推荐仍要求类目相关、明确视频、近60天、真实粉丝≤1万。未知粉丝不算低粉，候选不自动等于平台爆款。
- 所有内容进入持久化分析队列，每批18条，内容未变化不重复分析，失败有限重试。
- 先分析、发现共同点并聚类，再每组生成一张灵感卡；单条合格视频可形成创作参考，不拆成多个重复灵感。
- 卡片区分文字观察与AI创作建议，关联保存视频ID、理由和逐字依据，不使用tag堆砌作为总结。
- 搜索、正文和作者粉丝缓存分别复用，分批续采保留结果。长期规则见 [内容聚合长期规则](docs/内容聚合长期规则V5.md)。

采集由本机API或脚本管理，页面不提供采集按钮。例如：

```powershell
$body = @{ selection = @{ categoryId = 'bags'; days = 60 }; continue = $true } | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:3000/api/category/start -Method Post -ContentType application/json -Body $body
```

只分析或核实缓存时，POST `/api/category/start` 使用 `mode: "analyze-existing"`。取消使用 POST `/api/category/cancel`，提供任务 `id`。接口只接受本机同源调用。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

测试覆盖或门槛、真实低粉与日期筛选、持久化分批分析、余额不足保留队列、重复方向聚合、关联证据校验和取消。测试使用合成数据及接口模拟，不依赖登录账号或本地采集数据库。
