import { z } from "zod";
import { model } from "../lib/model";
try {
  const response = await model(
    "连接验证",
    z.object({ message: z.string() }),
    { task: "请返回 message 为连接成功，不做任何分析" },
    (ms, tokens) => console.log(JSON.stringify({ ms, tokens })),
  );
  console.log({ modelConfigured: true, validJson: !!response.message });
} catch (e) {
  console.log((e as Error).message);
  process.exitCode = 2;
}
