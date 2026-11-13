import { generateKeyPairSync, createPublicKey, type KeyObject } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { jwtVerify } from 'jose';

export type StubRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};
export type StubReply = { status?: number; json?: unknown; headers?: Record<string, string> };
export type StubHandler = (request: StubRequest) => StubReply | Promise<StubReply>;

/** Local GitHub stand-in bound to a random port; the panel reaches it through githubApiUrl. */
export async function startGithubStub() {
  const routes = new Map<string, StubHandler>();
  const requests: StubRequest[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://stub');
      const request: StubRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      };
      requests.push(request);
      const handler = routes.get(`${request.method} ${request.path}`);
      const reply = handler ? await handler(request) : { status: 404, json: { message: 'Not Found' } };
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
      res.end(JSON.stringify(reply.json ?? {}));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    on: (route: string, handler: StubHandler | StubReply) =>
      void routes.set(route, typeof handler === 'function' ? handler : () => handler),
    count: (route: string) => requests.filter((r) => `${r.method} ${r.path}` === route).length,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type GithubStub = Awaited<ReturnType<typeof startGithubStub>>;

export type AppKeys = { privatePem: string; publicKey: KeyObject };

/** A real RSA key in GitHub's PKCS#1 format, plus the public half to verify app JWTs. */
export function makeAppKeys(): AppKeys {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicKey: createPublicKey(privateKey),
  };
}

/** Verifies the `Authorization: Bearer <app jwt>` header and returns its claims. */
export async function verifyAppJwt(keys: AppKeys, authorization: string | undefined) {
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
  if (!token) throw new Error('missing bearer');
  const { payload, protectedHeader } = await jwtVerify(token, keys.publicKey, { algorithms: ['RS256'] });
  return { payload, protectedHeader };
}
