import "reflect-metadata";
import { container } from "tsyringe";
import { FeedService } from "../services/feed.service";
import { LoggerService } from "../services/logger.service";

const logger = {
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ""),
  debug: (msg: string, meta?: any) => {},
};
container.registerInstance(LoggerService, logger as any);

async function checkDistribution() {
  console.log("📊 Checking Feed Distribution (Limit 100)...");
  
  const service = container.resolve(FeedService);
  const response = await service.fetchFeed(100);
  
  const counts = response.items.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log("Item counts in first 100:", counts);
  console.log("Total items:", response.items.length);
  
  console.log("\nFirst 10 sources order:");
  console.log(response.items.slice(0, 10).map(i => i.source).join(" -> "));
  
  process.exit(0);
}

checkDistribution().catch(console.error);
