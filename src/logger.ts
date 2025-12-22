import pino from "pino";

export interface Logger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
}

interface CreateLoggerOptions {
  correlationId?: string;
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const { correlationId = "no-correlation-id" } = options;
  const isProd =
    process.env.NODE_ENV === "prod" || process.env.NODE_ENV === "production";

  if (!isProd) {
    // Logger de desenvolvimento com pino-pretty
    const devLogger = pino({
      level: "info",
      base: {
        correlationId,
      },
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:dd/mm/yyyy HH:MM:ss",
          ignore: "hostname",
          messageFormat: "[{correlationId}] [{context}] {msg}",
          singleLine: false,
        },
      },
    });

    return {
      debug: (message: string, metadata = {}) =>
        devLogger.debug({ context: "Application", ...metadata }, message),
      info: (message: string, metadata = {}) =>
        devLogger.info({ context: "Application", ...metadata }, message),
      warn: (message: string, metadata = {}) =>
        devLogger.warn({ context: "Application", ...metadata }, message),
      error: (message: string, metadata = {}) =>
        devLogger.error({ context: "Application", ...metadata }, message),
    };
  }

  // Logger de produção compatível com GCP Cloud Logging
  const prodLogger = pino({
    level: "info",
    base: null,
    formatters: {
      level: (label) => {
        const severities: Record<string, string> = {
          info: "INFO",
          warn: "WARNING",
          error: "ERROR",
          debug: "DEBUG",
          trace: "DEBUG",
          fatal: "CRITICAL",
        };
        return { severity: severities[label] || label.toUpperCase() };
      },
    },
    timestamp: false, // GCP adiciona seu próprio timestamp
    // Hook para interceptar e modificar o log antes de ser escrito
    hooks: {
      logMethod(inputArgs, method) {
        if (inputArgs.length >= 2) {
          const [obj, msg, ...rest] = inputArgs;
          // Cria novo objeto com "message" ao invés de passar como segundo parâmetro
          const newObj = {
            ...(typeof obj === "object" && obj !== null ? obj : {}),
            message: msg,
          };
          return method.apply(this, [newObj, ...rest] as Parameters<
            typeof method
          >);
        }
        return method.apply(this, inputArgs);
      },
    },
  });

  return {
    debug: (message: string, metadata = {}) => {
      prodLogger.info(
        {
          correlationId,
          context: "Application",
          ...metadata,
        },
        message,
      );
    },
    info: (message: string, metadata = {}) => {
      prodLogger.info(
        {
          correlationId,
          context: "Application",
          ...metadata,
        },
        message,
      );
    },
    warn: (message: string, metadata = {}) => {
      prodLogger.warn(
        {
          correlationId,
          context: "Application",
          ...metadata,
        },
        message,
      );
    },
    error: (message: string, metadata = {}) => {
      prodLogger.error(
        {
          correlationId,
          context: "Application",
          ...metadata,
        },
        message,
      );
    },
  };
};

// Logger global para uso geral (sem correlation ID)
export const logger = createLogger();
