import { z } from 'zod';

export class PanelEnvError extends Error {
  override name = 'PanelEnvError';
}

/** Unset and empty (compose passes `${VAR:-}`) both mean "not set". */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());
const defaulted = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().trim().default(fallback));
const lowerEmail = z.string().trim().toLowerCase().pipe(z.email());

const encryptionKey = z
  .string()
  .trim()
  .min(1, 'is required')
  .transform((value, ctx) => {
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) {
      ctx.addIssue({ code: 'custom', message: `must be 32 bytes of base64 (got ${key.length})` });
      return z.NEVER;
    }
    return key;
  });

const panelEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().trim().min(1, 'is required'),
  PANEL_ENCRYPTION_KEY: encryptionKey,
  ALLOWED_EMAIL: lowerEmail,
  CF_ACCESS_TEAM_DOMAIN: z.string().trim().min(1, 'is required'),
  CF_ACCESS_AUD: z.string().trim().min(1, 'is required'),
  CF_ACCESS_DEV_BYPASS_EMAIL: z.preprocess(blankToUndefined, lowerEmail.optional()),
  CF_ACCESS_JWKS_URL: optionalUrl,
  DOCKER_HOST: defaulted('tcp://docker-proxy:2375'),
  HOSTSTATS_URL: defaulted('http://hoststats:9100'),
  RUNNER_IMAGE: defaulted('claudecloud-runner:local'),
  SESSION_RUNTIME: defaulted('sysbox-runc'),
  CONFIGS_DIR: defaulted('/app/configs'),
  PANEL_PUBLIC_URL: z.url(),
  RUNNER_API_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).default(3100)),
  GITHUB_API_URL: z.preprocess(blankToUndefined, z.url().default('https://api.github.com')),
  // e2e only, e.g. file:///repos/{owner}/{name}.git. Becomes the runner's REPO_URL.
  SESSION_REPO_URL_TEMPLATE: optionalString,
  // Local-dev fallbacks when the panel is not itself on the stack network.
  STACK_NETWORK: optionalString,
  CLAUDE_AUTH_VOLUME: optionalString,
});

export type PanelEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  encryptionKey: Buffer;
  allowedEmail: string;
  cfAccessTeamDomain: string;
  cfAccessAud: string;
  devBypassEmail: string | null;
  dockerHost: string;
  hoststatsUrl: string;
  runnerImage: string;
  sessionRuntime: string;
  configsDir: string;
  publicUrl: string;
  runnerApiPort: number;
  cfAccessJwksUrl: string | null;
  githubApiUrl: string;
  sessionRepoUrlTemplate: string | null;
  stackNetwork: string | null;
  claudeAuthVolume: string | null;
};

export function parsePanelEnv(source: Record<string, string | undefined>): PanelEnv {
  const result = panelEnvSchema.safeParse(source);
  const problems = result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  if (result.success && result.data.NODE_ENV === 'production' && result.data.CF_ACCESS_DEV_BYPASS_EMAIL) {
    problems.push('CF_ACCESS_DEV_BYPASS_EMAIL: must not be set when NODE_ENV=production');
  }
  if (!result.success || problems.length > 0) {
    throw new PanelEnvError(`Invalid panel environment. ${problems.join('; ')}`);
  }
  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    encryptionKey: data.PANEL_ENCRYPTION_KEY,
    allowedEmail: data.ALLOWED_EMAIL,
    cfAccessTeamDomain: data.CF_ACCESS_TEAM_DOMAIN,
    cfAccessAud: data.CF_ACCESS_AUD,
    devBypassEmail: data.CF_ACCESS_DEV_BYPASS_EMAIL ?? null,
    dockerHost: data.DOCKER_HOST,
    hoststatsUrl: data.HOSTSTATS_URL,
    runnerImage: data.RUNNER_IMAGE,
    sessionRuntime: data.SESSION_RUNTIME,
    configsDir: data.CONFIGS_DIR,
    publicUrl: data.PANEL_PUBLIC_URL,
    runnerApiPort: data.RUNNER_API_PORT,
    cfAccessJwksUrl: data.CF_ACCESS_JWKS_URL ?? null,
    githubApiUrl: data.GITHUB_API_URL,
    sessionRepoUrlTemplate: data.SESSION_REPO_URL_TEMPLATE ?? null,
    stackNetwork: data.STACK_NETWORK ?? null,
    claudeAuthVolume: data.CLAUDE_AUTH_VOLUME ?? null,
  };
}

let cached: PanelEnv | undefined;
/** Request-time only: memoised, throws PanelEnvError listing every missing or invalid var. */
export function getPanelEnv(): PanelEnv {
  return (cached ??= parsePanelEnv(process.env));
}
