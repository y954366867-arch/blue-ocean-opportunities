import "./style.css";
export const metadata = {
  title: "蓝海商机 · 类目内容灵感",
  description: "类目筛选、真实高热视频方向与代表视频",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
