import net from "node:net";

export async function assertPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(port, host, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Port ${host}:${port} is not available: ${detail}`);
  });
}
