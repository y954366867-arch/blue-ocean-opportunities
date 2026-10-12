import { z } from "zod";
export const StyleProfileSchema = z.object({
  category: z.string(),
  styleTerms: z.array(z.string()),
  shape: z.string(),
  colors: z.array(z.string()),
  visualTraits: z.array(z.string()),
  scenes: z.array(z.string()),
  excludedStyles: z.array(z.string()),
  referenceImages: z.array(z.string()),
  source: z.literal("user-text"),
  confirmedByUser: z.boolean(),
  version: z.number(),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;
export type Timing = {
  name: string;
  start: string;
  end: string;
  ms: number;
  status: string;
  retries: number;
  count: number;
  cacheHit: boolean;
};
export const ProductSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  name: z.string().max(200),
  category: z.string().max(200),
  price: z.string().max(200),
  specs: z.string().max(2000),
  sellingPoints: z.array(z.string().max(500)).max(20),
  limits: z.string().max(2000),
  budget: z.string().max(200),
  images: z.array(z.string().max(3000000)).max(3),
  styleDescription: z.string().max(2000).optional(),
  styleShape: z.string().max(500).optional(),
  styleColors: z.string().max(500).optional(),
  visualTraits: z.string().max(1000).optional(),
  styleScenes: z.string().max(1000).optional(),
  excludedStyles: z.string().max(1000).optional(),
});
export type Product = z.infer<typeof ProductSchema>;
export const ProvenanceSchema = z.object({
  source: z.enum(["live", "import", "sample"]),
  collectedAt: z.string().datetime(),
  coverage: z.string().min(1).max(2000),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
const metrics = z.object({
  likes: z.number().nonnegative().nullable(),
  favorites: z.number().nonnegative().nullable(),
  comments: z.number().nonnegative().nullable(),
});
export const NoteSchema = z.object({
  contentType: z.enum(["video", "image", "unknown"]).optional(),
  typeSource: z.string().optional(),
  id: z.string().min(1).max(200),
  platformId: z.string().min(1).max(200),
  creatorId: z.string().max(200),
  creatorName: z.string().max(200),
  title: z.string().max(2000),
  text: z.string().max(20000),
  publishedAt: z.string().nullable(),
  metrics,
  metricsRaw: z
    .object({
      likes: z.string().nullable(),
      favorites: z.string().nullable(),
      comments: z.string().nullable(),
    })
    .optional(),
  collectedAt: z.string().datetime().optional(),
  images: z.array(z.string()).max(30),
  queries: z.array(z.string()).max(10),
  ref: z.object({ xsecToken: z.string().max(3000) }).optional(),
  kind: z.enum(["candidate", "creator-post"]).default("candidate"),
});
export type Note = z.infer<typeof NoteSchema>;
export const CommentSchema = z.object({
  id: z.string().min(1).max(200),
  platformId: z.string().max(200),
  noteId: z.string().max(200),
  parentId: z.string().nullable(),
  userId: z.string().nullable(),
  text: z.string().max(10000),
  target: z.string().nullable().default(null),
});
export type Comment = z.infer<typeof CommentSchema>;
export const DatasetSchema = z.object({
  provenance: ProvenanceSchema,
  notes: z.array(NoteSchema).max(1000),
  comments: z.array(CommentSchema).max(10000),
});
export type Dataset = z.infer<typeof DatasetSchema>;
export const AnalysisSchema = z.object({
  relevance: z.array(
    z.object({
      noteId: z.string(),
      status: z.enum(["direct", "adjacent", "irrelevant", "unknown"]),
      reason: z.string(),
    }),
  ),
  labels: z.array(
    z.object({
      commentId: z.string(),
      target: z.enum(["product", "other", "unknown"]),
      tags: z
        .array(
          z.enum([
            "商品兴趣",
            "购买顾虑",
            "使用痛点",
            "场景需求",
            "内容欣赏",
            "售后问题",
            "无关",
            "无法判断",
          ]),
        )
        .max(8),
    }),
  ),
  demands: z
    .array(
      z.object({
        id: z.string(),
        scene: z.string(),
        problem: z.string(),
        concern: z.string(),
        canMeet: z.enum(["yes", "no", "unknown"]),
        unknowns: z.array(z.string()),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(15),
  topics: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        audience: z.string(),
        scene: z.string(),
        buyingReason: z.string(),
        match: z.string(),
        limitations: z.string(),
        title: z.string(),
        angle: z.string(),
        steps: z.array(z.string()).min(3).max(5),
        evidenceIds: z.array(z.string()).min(1),
        factIndices: z.array(z.number().int().nonnegative()),
        unknowns: z.array(z.string()),
      }),
    )
    .max(3),
  creators: z
    .array(
      z.object({
        id: z.string(),
        creatorId: z.string(),
        reason: z.string(),
        mismatch: z.string(),
        evidenceIds: z.array(z.string()).min(1),
        unknowns: z.array(z.string()),
        questions: z.array(z.string()),
        status: z.enum(["适合进一步了解", "信息不足", "暂不推荐"]),
      }),
    )
    .max(5),
  reasons: z.object({ topics: z.string(), creators: z.string() }),
  notRecommended: z
    .object({
      direction: z.string(),
      reason: z.string(),
      evidenceIds: z.array(z.string()).min(1),
    })
    .nullable(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;
export type ValidAnalysis = Omit<Analysis, "demands" | "creators"> & {
  demands: (Analysis["demands"][number] & {
    commentCount: number;
    noteCount: number;
    userCount: number | null;
  })[];
  creators: (Analysis["creators"][number] & {
    name: string;
    postCount: number;
    quote: null;
    quoteSource: null;
  })[];
  productVersion: number;
  analysisVersion: number;
  warnings: string[];
};
export type Run = {
  engineVersion?: 2;
  styleProfile?: StyleProfile;
  timings?: Timing[];
  activeMs?: number;
  firstResultMs?: number;
  forceRefresh?: boolean;
  v2?: StyleResult;
  v2History?: StyleResult[];
  pendingStyleMatches?: z.infer<typeof StyleMatchSchema>[];
  id: string;
  product: Product;
  queries: string[];
  status: "queued" | "running" | "cancelled" | "failed" | "complete";
  stage: string;
  done: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  dataset: Dataset;
  errors: string[];
  cancelRequested: boolean;
  result: ValidAnalysis | null;
  history: ValidAnalysis[];
  corrections: Correction[];
  usage: { stage: string; ms: number; tokens: number | null }[];
  calls: number;
  collectedQueries: string[];
  deepReadIds: string[];
  creatorReadIds: string[];
};
export const StyleMatchSchema = z.object({
  noteId: z.string(),
  status: z.enum(["适配", "相邻可借鉴", "不适配", "信息不足"]),
  reason: z.string(),
  matchedFeatures: z.array(z.string()),
  conflicts: z.array(z.string()),
});
export const StyleCardsSchema = z.object({
  topics: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        title: z.string(),
        angle: z.string(),
        match: z.string(),
        commonPattern: z.string(),
        steps: z.array(z.string()).min(3).max(5),
        evidenceIds: z.array(z.string()).min(1),
        unknowns: z.array(z.string()),
      }),
    )
    .max(3),
});
export type StyleResult = {
  commentInsights?: {
    commentId: string;
    target: "同品类商品" | "其他商品" | "整体穿搭或内容" | "不明确";
    insight: string;
  }[];
  version: 2;
  analysisVersion: number;
  matches: z.infer<typeof StyleMatchSchema>[];
  topics: (z.infer<typeof StyleCardsSchema>["topics"][number] & {
    kind: "高热参考" | "内容方向";
    strength: string;
  })[];
  creators: {
    id: string;
    name: string;
    evidenceIds: string[];
    reason: string;
    status: string;
    postCount: number;
    dates: string[];
  }[];
  hotIds: string[];
  waitingIds: string[];
  sampleSize: number;
  comparison: string;
  warnings: string[];
};
export const StyleAuditSchema = StyleCardsSchema.extend({
  supports: z.array(
    z.object({
      topicId: z.string(),
      noteId: z.string(),
      quote: z.string(),
      supportsPattern: z.boolean(),
    }),
  ),
});
export const CorrectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exclude-note"), id: z.string() }),
  z.object({ kind: z.literal("exclude-creator"), id: z.string() }),
  z.object({
    kind: z.literal("comment-target"),
    id: z.string(),
    target: z.enum(["product", "other", "unknown", "category", "content"]),
  }),
  z.object({ kind: z.literal("preference"), text: z.string().max(1000) }),
]);
export type Correction = z.infer<typeof CorrectionSchema>;
