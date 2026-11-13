import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PanelEnvError, parsePanelEnv } from '@/env/panel-env';

const key = randomBytes(32).toString('base64');

const complete = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://claudecloud:claudecloud@localhost:54330/claudecloud',
  PANEL_ENCRYPTION_KEY: key,
  ALLOWED_EMAIL: '  Owner@Example.com ',
  CF_ACCESS_TEAM_DOMAIN: 'myteam.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud-tag',
  PANEL_PUBLIC_URL: 'https://claude.example.com',
};

describe('parsePanelEnv', () => {
  it('parses a complete production env', () => {
    const env = parsePanelEnv(complete);
    expect(env.allowedEmail).toBe('owner@example.com');
    expect(env.encryptionKey.length).toBe(32);
    expect(env.devBypassEmail).toBeNull();
    expect(env.dockerHost).toBe('tcp://docker-proxy:2375');
    expect(env.hoststatsUrl).toBe('http://hoststats:9100');
    expect(env.runnerImage).toBe('claudecloud-runner:local');
    expect(env.sessionRuntime).toBe('sysbox-runc');
    expect(env.configsDir).toBe('/app/configs');
    expect(env.runnerApiPort).toBe(3100);
    expect(env.githubApiUrl).toBe('https://api.github.com');
    expect(env.sessionRepoUrlTemplate).toBeNull();
    expect(env.cfAccessJwksUrl).toBeNull();
    expect(env.stackNetwork).toBeNull();
    expect(env.claudeAuthVolume).toBeNull();
  });

  it('rejects CF_ACCESS_DEV_BYPASS_EMAIL when NODE_ENV=production', () => {
    expect(() => parsePanelEnv({ ...complete, CF_ACCESS_DEV_BYPASS_EMAIL: 'a@b.co' })).toThrow(
      PanelEnvError,
    );
    expect(() => parsePanelEnv({ ...complete, CF_ACCESS_DEV_BYPASS_EMAIL: 'a@b.co' })).toThrow(
      /CF_ACCESS_DEV_BYPASS_EMAIL/,
    );
  });

  it('allows the dev bypass outside production', () => {
    const env = parsePanelEnv({
      ...complete,
      NODE_ENV: 'development',
      CF_ACCESS_DEV_BYPASS_EMAIL: ' Dev@B.co ',
    });
    expect(env.devBypassEmail).toBe('dev@b.co');
  });

  it('reports every missing var at once', () => {
    const { ALLOWED_EMAIL: _a, CF_ACCESS_AUD: _b, ...rest } = complete;
    let message = '';
    try {
      parsePanelEnv(rest);
    } catch (error) {
      expect(error).toBeInstanceOf(PanelEnvError);
      message = (error as Error).message;
    }
    expect(message).toContain('ALLOWED_EMAIL');
    expect(message).toContain('CF_ACCESS_AUD');
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => parsePanelEnv({ ...complete, PANEL_ENCRYPTION_KEY: short })).toThrow(
      /PANEL_ENCRYPTION_KEY/,
    );
  });
});
