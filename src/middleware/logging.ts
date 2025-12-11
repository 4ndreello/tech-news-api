import type { Context, Next } from "hono";
import { createLogger } from "../logger";
import { randomUUID } from "crypto";

// Extend Hono context with logger
declare module "hono" {
  interface ContextVariableMap {
    logger: ReturnType<typeof createLogger>;
    correlationId: string;
  }
}

/**
 * Middleware de logging para Hono
 * Adiciona logger ao contexto e registra requisições/respostas
 */
export const loggingMiddleware = async (c: Context, next: Next) => {
  // Gera correlation ID único para rastrear a requisição
  const correlationId = c.req.header("x-correlation-id") || randomUUID();

  // Adiciona correlation ID e logger ao contexto
  c.set("correlationId", correlationId);
  const logger = createLogger({ correlationId });
  c.set("logger", logger);

  const path = c.req.path;

  // Ignora arquivos estáticos (extensões de arquivo)
  const hasFileExtension = /\.[a-z0-9]+$/i.test(path);

  if (hasFileExtension) {
    await next();
    return;
  }

  // Marca o início da requisição
  const startTime = Date.now();
  const method = c.req.method;

  logger.info(`INCOMING REQUEST ${method} ${path}`, {
    context: "HttpRequest",
    httpRequest: {
      requestMethod: method,
      requestUrl: path,
      queryParams: c.req.query(),
      userAgent: c.req.header("user-agent"),
    },
  });

  // Executa o handler
  await next();

  const duration = Date.now() - startTime;
  const status = c.res.status;

  logger.info(`OUTGOING RESPONSE ${status} - ${duration}ms`, {
    context: "HttpRequest",
    httpResponse: {
      status,
      duration: `${duration}ms`,
      durationMs: duration,
    },
  });

  // Adiciona correlation ID ao header da resposta
  c.header("X-Correlation-Id", correlationId);
};
