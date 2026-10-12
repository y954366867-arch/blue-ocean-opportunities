import type { Dataset, Run } from "./schema";
// No provider refs, tokens, image CDN querystrings, or raw provider errors cross this boundary.
export function publicDataset(d: Dataset) {
  return {
    ...d,
    notes: d.notes.map(({ ref, images, ...n }) => ({
      ...n,
      images: images.map((x) => {
        try {
          const u = new URL(x);
          u.search = "";
          return u.toString();
        } catch {
          return "";
        }
      }),
    })),
  };
}
export function publicRun(r: Run) {
  return { ...r, dataset: publicDataset(r.dataset) };
}
export function noteUrl(platformId: string) {
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(platformId)}`;
}
export function creatorUrl(id: string) {
  return `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(id)}`;
}
