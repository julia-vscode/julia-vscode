import * as path from 'path';
import * as os from 'os';

export function generatePipeName(pid: string, name: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid;
    }
    else {
        return path.join(os.tmpdir(), name + '-' + pid);
    }
}
