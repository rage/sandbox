import http from "node:http";

export interface NotifyResult {
  token: string;
  test_output: string;
  stdout: string;
  stderr: string;
  valgrind: string;
  validations: string;
  vm_log: string;
  status: "finished" | "timeout" | "out-of-memory" | "crashed" | "failed";
  exit_code: string;
  error?: string;
}

export interface CallbackServer {
  url: string;
  waitForResult: () => Promise<NotifyResult>;
  close: () => void;
}

export async function createCallbackServer(timeoutMs = 120_000): Promise<CallbackServer> {
  // The Promise constructor executor runs synchronously, so both callbacks are assigned
  // before the constructor returns. The typed object approach avoids definite-assignment
  // assertions while keeping strict-mode checks on the call sites.
  const callbacks: {
    resolve: ((result: NotifyResult) => void) | undefined;
    reject: ((err: Error) => void) | undefined;
  } = { resolve: undefined, reject: undefined };
  const resultPromise = new Promise<NotifyResult>((resolve, reject) => {
    callbacks.resolve = resolve;
    callbacks.reject = reject;
  });

  const timer = setTimeout(() => {
    callbacks.reject?.(new Error(`Callback server timed out after ${timeoutMs}ms`));
    server.close();
  }, timeoutMs);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      clearTimeout(timer);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as NotifyResult;
        callbacks.resolve?.(body);
      } catch (error) {
        callbacks.reject?.(error instanceof Error ? error : new Error(String(error)));
      }
      res.writeHead(200);
      res.end();
      setImmediate(() => server.close());
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
    server.listen(0);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get callback server port");
  }

  return {
    url: `http://localhost:${address.port}`,
    waitForResult: () => resultPromise,
    close: () => {
      clearTimeout(timer);
      server.close();
    },
  };
}
