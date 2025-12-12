import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  correlationId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getCorrelationId(): string {
  const context = requestContext.getStore();
  return context?.correlationId || "no-correlation-id";
}

export function setRequestContext(correlationId: string): void {
  requestContext.enterWith({ correlationId });
}
