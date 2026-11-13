import { PassThrough, type Readable } from 'node:stream';
import tar from 'tar-stream';
import type { MergedConfig } from '@/profiles/merge-profiles';

const ARCHIVE_ROOT = 'session-config';
const SESSION_USER = 1000;

/** Tar of the merged config rooted at `session-config/`; `putArchive(..., { path: '/opt' })` yields `/opt/session-config`. */
export function toTarStream(merged: MergedConfig): Readable {
  const pack = tar.pack();
  const paths = [...merged.keys()].sort();
  const dirs = new Set<string>([ARCHIVE_ROOT]);
  for (const file of paths) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(`${ARCHIVE_ROOT}/${parts.slice(0, i).join('/')}`);
  }
  const owner = { uid: SESSION_USER, gid: SESSION_USER, mtime: new Date(0) };
  for (const dir of [...dirs].sort()) {
    pack.entry({ name: dir, type: 'directory', mode: 0o755, ...owner });
  }
  for (const file of paths) {
    const mode = file.endsWith('.sh') ? 0o755 : 0o644;
    pack.entry({ name: `${ARCHIVE_ROOT}/${file}`, type: 'file', mode, ...owner }, merged.get(file)!);
  }
  pack.finalize();
  return pack.pipe(new PassThrough());
}
