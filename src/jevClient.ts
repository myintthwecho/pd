import type { RefundRequest } from "./types.ts";
import { buildJevRequest } from "./jevConfig.ts";

export interface DecisionTransport {
  decide(request: RefundRequest, signal?: AbortSignal): Promise<unknown>;
}

export class JevHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JevHttpError";
    this.status = status;
  }
}

export interface HttpTransportOptions {
  endpoint: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function createHttpTransport(
  options: HttpTransportOptions,
): DecisionTransport {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async decide(request, signal) {
      const body = buildJevRequest(request);
      if (options.model) {
        body.model = options.model;
      }

      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        throw new JevHttpError(
          response.status,
          `Jev request failed with HTTP ${response.status}`,
        );
      }

      return (await response.json()) as unknown;
    },
  };
}
