import {categoryRuns,refresh} from '../lib/category-v4';
import {save} from '../lib/db';
import {summarize,summaryFingerprint} from '../lib/content-analysis';
const seen=new Set<string>();
for(const r of categoryRuns()){
 if(r.selection.days!==60||seen.has(r.selection.categoryId))continue;
 seen.add(r.selection.categoryId);
 const pending=r.directions.filter(d=>d.summaryStatus!=='ready');
 if(!pending.length)continue;
 if(!r.contentGroups?.length)save('content-clusters-v13',summaryFingerprint(r,r.qualifiedIds),null);
 // 用户明确要求补完此前耗尽自动重试的总结，仅开启本次两次有限重试。
 for(const d of pending)save('creative-summary-failure',summaryFingerprint(r,d.noteIds),{attempts:0});
 const persist=()=>save('category-run',r.id,r);
 for(let attempt=0;attempt<2;attempt++){
  await summarize(r,new AbortController().signal,Date.now()+150000,persist);
  refresh(r);persist();
  console.log(JSON.stringify({category:r.selection.categoryId,ready:r.directions.filter(d=>d.summaryStatus==='ready').map(d=>d.name),pending:r.directions.filter(d=>d.summaryStatus!=='ready').length}));
  if(r.directions.every(d=>d.summaryStatus==='ready'))break;
 }
 if(r.directions.some(d=>d.summaryStatus!=='ready'))throw Error(r.selection.categoryId+' 总结仍未完成');
}
