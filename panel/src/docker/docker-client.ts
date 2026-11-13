import Docker, { type DockerOptions } from 'dockerode';
import { getPanelEnv } from '@/env/panel-env';

/** Maps DOCKER_HOST (tcp://, unix://, npipe://) to dockerode options. */
export function dockerOptionsFromHost(dockerHost: string): DockerOptions {
  // URL parsing normalises the `.` segment out of npipe paths, so handle that scheme by hand.
  if (dockerHost.startsWith('npipe:')) {
    return { socketPath: dockerHost.slice('npipe:'.length).replace(/^\/+/, '//') };
  }
  const url = new URL(dockerHost);
  switch (url.protocol) {
    case 'tcp:':
    case 'http:':
      return { host: url.hostname, port: Number(url.port) || 2375, protocol: 'http' };
    case 'https:':
      return { host: url.hostname, port: Number(url.port) || 2376, protocol: 'https' };
    case 'unix:':
      return { socketPath: decodeURIComponent(url.pathname) };
    default:
      throw new Error(`Unsupported DOCKER_HOST scheme: ${url.protocol}`);
  }
}

let shared: Docker | undefined;

/** The panel's single Docker client. Created on first use so importing never needs the environment. */
export const docker: Docker = new Proxy({} as Docker, {
  get(_target, prop) {
    shared ??= new Docker(dockerOptionsFromHost(getPanelEnv().dockerHost));
    const value: unknown = Reflect.get(shared, prop, shared);
    return typeof value === 'function' ? value.bind(shared) : value;
  },
});
