# VPS setup: Sysbox for Docker-in-session

Session containers run their own Docker daemon (spec call #14) under the
[Sysbox](https://github.com/nestybox/sysbox) runtime — unprivileged, with no
access to the host's Docker socket. Sysbox is a one-time host install, done
outside Coolify. The deploy walkthrough is in the [README](../README.md).

> Version-specific details (package names, supported kernels, installer
> behaviour) change between Sysbox releases. Check the release notes of the
> version you install; the steps below are the shape, not a substitute.

## 1. Check the host is supported

```bash
cat /etc/os-release        # Ubuntu 20.04 / 22.04 / 24.04 or Debian 11 / 12
uname -r                   # kernel ≥ 5.12 recommended (shiftfs/idmapped mounts)
docker version --format '{{.Server.Version}}'
docker info --format '{{json .Runtimes}}'   # sysbox-runc should not be there yet
```

Unsupported distro or kernel → stop here and see "Fallback" below.

## 2. Snapshot what's running (so you can prove nothing broke)

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | sort > ~/containers-before.txt
sudo cp /etc/docker/daemon.json ~/daemon.json.bak 2>/dev/null || echo "no daemon.json"
```

Also open the Coolify dashboard and note that every resource is healthy.

## 3. Install Sysbox

Pick the latest `sysbox-ce` release for your architecture from
<https://github.com/nestybox/sysbox/releases>, then:

```bash
sudo apt-get update && sudo apt-get install -y jq wget
wget https://downloads.nestybox.com/sysbox/releases/v<VERSION>/sysbox-ce_<VERSION>.linux_amd64.deb
sudo apt-get install -y ./sysbox-ce_<VERSION>.linux_amd64.deb
```

**Expect Docker to restart.** The package registers `sysbox-runc` in
`/etc/docker/daemon.json` and restarts the Docker daemon, which stops and
restarts every container on the host — Coolify itself and everything it
manages. Containers with a restart policy (Coolify sets one) come back on
their own. Do it in a quiet moment. Some Sysbox versions refuse to install
while containers are running and ask you to stop them first; follow what the
installer says.

## 4. Confirm the runtime and that Coolify is unaffected

```bash
docker info --format '{{json .Runtimes}}' | grep sysbox-runc
systemctl status sysbox --no-pager
docker ps --format '{{.Names}}\t{{.Status}}' | sort > ~/containers-after.txt
diff <(cut -f1 ~/containers-before.txt) <(cut -f1 ~/containers-after.txt) && echo "same containers running"
```

Then check the Coolify dashboard again: all resources healthy, the proxy
serving your domains.

## 5. Verify Docker-in-session

From a checkout of this repo on the VPS:

```bash
bash runner/scripts/verify-sysbox.sh
```

It builds the runner image, starts a stand-in panel and a session container
with `--runtime=sysbox-runc -e SESSION_DOCKER=true` (the stub replaces Claude),
then checks inside the session: `docker run --rm hello-world`, `docker compose
version`, and that the inner `docker ps` sees none of the host's containers.
It also checks no host container stopped. Success prints `SYSBOX OK`.

## Session container requirements (for the panel, Plan 2)

- `runtime: sysbox-runc` — never `privileged`, never the host socket.
- Mount the session's volume at `/var/lib/docker` (the image declares it a
  `VOLUME`) so inner images and containers stay off the overlay rootfs and are
  deleted with the session (`docker rm -v` / volume removal).
- The Docker socket proxy must allow setting `HostConfig.Runtime`.

## Rollback

```bash
sudo apt-get remove -y sysbox-ce
sudo cp ~/daemon.json.bak /etc/docker/daemon.json   # if you had one; else remove the sysbox runtime entry
sudo systemctl restart docker
docker info --format '{{json .Runtimes}}'            # sysbox-runc gone
```

Docker restarts again; Coolify containers come back via their restart policies.

## Fallback: rootless Docker-in-Docker

If Sysbox can't be installed (unsupported kernel/distro), the alternative is a
rootless `dockerd` inside the session container. Trade-off:

- It still needs relaxed security settings on the session container
  (`seccomp=unconfined` / `apparmor=unconfined` and `/dev/fuse` or similar),
  which weakens the isolation the spec asks for, though it stays far short of
  `--privileged` or the host socket.
- Slower storage (fuse-overlayfs), no privileged ports, some images and
  compose stacks behave differently.

This is a decision for the user before it's implemented.
