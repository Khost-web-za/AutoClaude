import { describe, expect, it } from 'vitest';
import { dockerOptionsFromHost } from '@/docker/docker-client';

describe('dockerOptionsFromHost', () => {
  it('maps tcp, unix and npipe', () => {
    expect(dockerOptionsFromHost('tcp://docker-proxy:2375')).toMatchObject({ host: 'docker-proxy', port: 2375 });
    expect(dockerOptionsFromHost('unix:///var/run/docker.sock')).toEqual({ socketPath: '/var/run/docker.sock' });
    expect(dockerOptionsFromHost('npipe:////./pipe/docker_engine')).toEqual({ socketPath: '//./pipe/docker_engine' });
  });
  it('rejects unknown schemes', () => {
    expect(() => dockerOptionsFromHost('ftp://x')).toThrow();
  });
});
