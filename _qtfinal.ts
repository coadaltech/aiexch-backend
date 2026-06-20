import "dotenv/config";
import { listGames } from "./src/services/casino/qtech-platform-client";
const t0=Date.now();
try {
  const r=await listGames({size:1000,timeout:60000});
  console.log(`OK ${Date.now()-t0}ms games=${r.games.length} total=${r.totalCount}`);
} catch(e:any){
  console.log(`FAIL ${Date.now()-t0}ms msg="${e?.message}" code=${e?.code} status=${e?.response?.status}`);
  console.log("data:", JSON.stringify(e?.response?.data)?.slice(0,300));
}
