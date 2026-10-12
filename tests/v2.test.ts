import { test } from "node:test";
import assert from "node:assert/strict";
import { metricEstimate, normalizeNote } from "../lib/collector";
import { rankHot, styleProfile } from "../lib/style";
import { qualifyPerformance } from "../lib/validation";
test("missing performance facts qualify a claim without deleting the style card", () => {
  assert.match(qualifyPerformance("防水轻量韩系搭配"), /需实测确认/);
  assert.equal(qualifyPerformance("韩系日常穿搭展示"), "韩系日常穿搭展示");
});
test("display counts retain approximate/lower-bound semantics", () => {
  assert.deepEqual(metricEstimate("1万+"), {
    value: 10000,
    mode: "lower-bound",
  });
  assert.deepEqual(metricEstimate("2.3万"), {
    value: 23000,
    mode: "approximate",
  });
  assert.equal(metricEstimate("未知").value, null);
});
test("top ranked tiny sample cannot pretend to be hot; 万 values are not lost", () => {
  const tiny = normalizeNote({
    id: "low",
    note: { title: "韩系", interactInfo: { likedCount: "3" } },
  });
  const hot = normalizeNote({
    id: "hot",
    note: { title: "韩系", interactInfo: { likedCount: "1万+" } },
  });
  assert.equal(rankHot([tiny]).hot.length, 0);
  assert.deepEqual(
    rankHot([tiny, hot]).hot.map((n) => n.platformId),
    ["hot"],
  );
});
test("price and commission do not enter style profile", () => {
  const p = {
    id: "x",
    version: 1,
    name: "韩式包包",
    category: "",
    price: "",
    specs: "",
    sellingPoints: [],
    limits: "",
    budget: "",
    images: [],
  };
  assert.deepEqual(
    styleProfile(p),
    styleProfile({ ...p, price: "9999", budget: "1%" }),
  );
});
