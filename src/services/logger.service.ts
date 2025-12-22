import { singleton } from "tsyringe";
import { createLogger, type Logger } from "../logger";
import { getCorrelationId } from "../context/request-context";

@singleton()
export class LoggerService implements Logger {
  private getLogger(): Logger {
    const correlationId = getCorrelationId();
    return createLogger({ correlationId });
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.getLogger().debug(message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.getLogger().info(message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.getLogger().warn(message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.getLogger().error(message, metadata);
  }
}
