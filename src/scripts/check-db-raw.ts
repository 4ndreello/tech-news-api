import "reflect-metadata";
import { container } from "tsyringe";
import { DataWarehouseService } from "../services/data-warehouse.service";
import { LoggerService } from "../services/logger.service";
import { Source } from "../types";

const logger = {
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || ""),
  error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ""),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ""),
  debug: (msg: string, meta?: any) => {},
};
container.registerInstance(LoggerService, logger as any);

async function check() {
  const warehouse = container.resolve(DataWarehouseService);
  await new Promise(r => setTimeout(r, 1000));

  // Check ALL time
  const items = await warehouse['rawCollection']?.find({ source: Source.Twitter }).toArray();
  
  console.log(`Total Twitter items in DB: ${items?.length}`);
  if (items && items.length > 0) {
    console.log("Sample fetchedAt:", items[0].fetchedAt);
    const now = new Date();
    const ageHours = (now.getTime() - new Date(items[0].fetchedAt).getTime()) / (1000 * 60 * 60);
    console.log(`Age in hours: ${ageHours.toFixed(2)}`);
  }

  await warehouse.disconnect();
}
check().catch(console.error);
