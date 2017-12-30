import * as vscode from 'vscode';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { timeout } from 'promise-timeout';

export interface ISettings {
    juliaExePath?: string;
}

export async function loadSettings(): Promise<ISettings> {
    let section = vscode.workspace.getConfiguration('julia');
    let juliaExePath = section ? section.get<string>('executablePath', 'null') : null;

    if (juliaExePath == null) {
        let terminal = null;
        let PIPE_PATH = generatePipeName(process.pid.toString(), "bf");
        var server = net.createServer();

        try {
            juliaExePath = await timeout(new Promise<string>(
                function (resolve, reject) {
                    server.on('connection', function (c) {
                        c.setEncoding('utf8');
                        c.on('data', function (d) {
                            let p = d.toString();
                            console.log('julia-exe-finder recieved: ' + p);
                            resolve(p);
                        });
                    }).on('close', function () {
                        console.log('julia-exe-finder server closed');
                    }).on('error', (err) => {
                        console.log('julia-exe-finder err' + err);
                        reject(err);
                    });

                    server.listen(PIPE_PATH, function () {
                        console.log('julia-exe-finder server on listening ' + PIPE_PATH);
                        terminal = vscode.window.createTerminal("julia-exe-finder");
                        // double quotes will cause trouble either in cmd or in powershell.
                        // avoid using double quotes by passing char array.
                        PIPE_PATH = PIPE_PATH.split('').join("','").replace(/\\/g, '\\\\');
                        console.log(PIPE_PATH);
                        terminal.sendText(`julia -e "write(connect(join(['${PIPE_PATH}'])), joinpath(Base.JULIA_HOME, Base.julia_exename()))"`);
                    })}), 5000);
        } catch (error) {
            console.log(error);
        } finally {
            terminal.dispose();
            server.close();
        }
    }

    return {
        juliaExePath
    };
}

function generatePipeName(pid: string, name: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid;
    }
    else {
        return path.join(os.tmpdir(), name + '-' + pid);
    }
}
