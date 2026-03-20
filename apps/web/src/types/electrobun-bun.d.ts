declare module "electrobun/bun" {
  export interface ElectrobunRPCSchema {
    bun: {
      requests: Record<
        string,
        {
          params: unknown;
          response: unknown;
        }
      >;
      messages: Record<string, unknown>;
    };
    webview: {
      requests: Record<
        string,
        {
          params: unknown;
          response: unknown;
        }
      >;
      messages: Record<string, unknown>;
    };
  }
}
