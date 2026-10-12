import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categories,Selection} from '../lib/category-v4';
test('新增十类目可选、具有宽词和商品范围，不接受未知类目',()=>{
 const ids=['accessories','personal-care','food-drinks','digital-accessories','daily-home','sports-outdoors','baby-kids','pet-supplies','stationery','toys'];
 assert.equal(categories.length,15);
 for(const id of ids){const c=categories.find(c=>c.id===id)!;assert.ok(c);assert.ok(c.children.length>=3);assert.equal(c.seedTerms.length,2);const s=Selection.parse({categoryId:id});assert.equal(s.days,60);assert.equal(s.maxFollowers,10000);}
 assert.equal(Selection.safeParse({categoryId:'not-a-category'}).success,false);
});
