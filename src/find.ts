import * as fs from 'fs';
import * as path from 'path';

export const exe = (name: string, platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32' ? `${name}.exe` : name;

// Windows has no executable bit: check existence only. Other platforms need X_OK.
export function find(name: string, dirs: string[], platform: NodeJS.Platform = process.platform): string | undefined {
  const flag = platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
  const ok = (p: string) => {
    try {
      fs.accessSync(p, flag);
      return true;
    } catch {
      return false;
    }
  };
  return dirs.map((d) => path.join(d, exe(name, platform))).find(ok);
}
