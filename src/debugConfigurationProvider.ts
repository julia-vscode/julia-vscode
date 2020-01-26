import * as vscode from 'vscode';
import * as juliaexepath from './juliaexepath';
import * as path from 'path'

export class JuliaDebugConfigurationProvider
    implements vscode.DebugConfigurationProvider {

    constructor(context) {
        this.context = context;
    }

    private context: any

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {     

        return (async () => {
            const bar = await juliaexepath.getJuliaExePath();
            const scriptpath = path.join(this.context.extensionPath, 'scripts', 'debugger', 'foo.jl')
            config.program = `${bar} ${scriptpath}`
            config.program = './scripts/debugadapter/run.bat'
            return config;
        })();
    }
}