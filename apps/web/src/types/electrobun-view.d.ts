declare module "electrobun/view" {
  export class Electroview<TSchema = unknown> {
    constructor(options: { rpc?: unknown });
    rpc?: {
      request: unknown;
    };

    static defineRPC<TSchema>(options: {
      maxRequestTime?: number;
      handlers: {
        requests: Record<string, unknown>;
        messages: Record<string, (payload: unknown) => void>;
      };
    }): unknown;
  }
}
