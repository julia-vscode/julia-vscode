import * as vscode from 'vscode'
import { executeInREPL } from './interactive/repl'

export class LmToolFeature {
    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.lm.registerTool('run-julia-code', new RunJuliaCodeTool()))
        context.subscriptions.push(vscode.lm.registerTool('restart-julia-repl', new RestartJuliaReplTool()))
        context.subscriptions.push(vscode.lm.registerTool('stop-julia-repl', new StopJuliaReplTool()))
        context.subscriptions.push(
            vscode.lm.registerTool('interrupt-julia-execution', new InterruptJuliaExecutionTool())
        )
        context.subscriptions.push(vscode.lm.registerTool('change-julia-environment', new ChangeJuliaEnvironmentTool()))
    }

    dispose() {}
}

interface IRunJuliaCodeToolParameters {
    code: string
}

export class StopJuliaReplTool implements vscode.LanguageModelTool<Record<string, never>> {
    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ) {
        await vscode.commands.executeCommand('language-julia.stopREPL')

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Julia REPL has been stopped.')])
    }

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ) {
        return {
            invocationMessage: 'Stopping Julia REPL',
            confirmationMessages: {
                title: 'Stop Julia REPL',
                message: new vscode.MarkdownString(
                    'Stop the Julia REPL? This will terminate the current session and clear all state.'
                ),
            },
        }
    }
}

export class InterruptJuliaExecutionTool implements vscode.LanguageModelTool<Record<string, never>> {
    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ) {
        await vscode.commands.executeCommand('language-julia.interrupt')

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Julia execution has been interrupted.'),
        ])
    }

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ) {
        return {
            invocationMessage: 'Interrupting Julia execution',
        }
    }
}

interface IChangeJuliaEnvironmentToolParameters {
    envPath: string
}

export class ChangeJuliaEnvironmentTool implements vscode.LanguageModelTool<IChangeJuliaEnvironmentToolParameters> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IChangeJuliaEnvironmentToolParameters>,
        _token: vscode.CancellationToken
    ) {
        await vscode.commands.executeCommand('language-julia.activateHere', vscode.Uri.parse(options.input.envPath))

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Julia environment changed to: ${options.input.envPath}`),
        ])
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IChangeJuliaEnvironmentToolParameters>,
        _token: vscode.CancellationToken
    ) {
        return {
            invocationMessage: `Changing Julia environment to ${options.input.envPath}`,
            confirmationMessages: {
                title: 'Change Julia Environment',
                message: new vscode.MarkdownString(`Change the Julia environment to \`${options.input.envPath}\`?`),
            },
        }
    }
}

export class RestartJuliaReplTool implements vscode.LanguageModelTool<Record<string, never>> {
    async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ) {
        await vscode.commands.executeCommand('language-julia.restartREPL')

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Julia REPL has been restarted.')])
    }

    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        _token: vscode.CancellationToken
    ) {
        return {
            invocationMessage: 'Restarting Julia REPL',
            confirmationMessages: {
                title: 'Restart Julia REPL',
                message: new vscode.MarkdownString('Restart the Julia REPL? This will clear all session state.'),
            },
        }
    }
}

export class RunJuliaCodeTool implements vscode.LanguageModelTool<IRunJuliaCodeToolParameters> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IRunJuliaCodeToolParameters>,
        _token: vscode.CancellationToken
    ) {
        const params = options.input as IRunJuliaCodeToolParameters

        const result = await executeInREPL(params.code, {
            showCodeInREPL: true,
            showResultInREPL: true,
            showErrorInREPL: true,
        })

        if (result.stackframe) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error:\n${result.all}`)])
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result.all)])
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IRunJuliaCodeToolParameters>,
        _token: vscode.CancellationToken
    ) {
        const confirmationMessages = {
            title: 'Run Julia code in REPL',
            message: new vscode.MarkdownString(
                `Run this Julia code in the REPL?` + `\n\n\`\`\`julia\n${options.input.code}\n\`\`\`\n`
            ),
        }

        return {
            invocationMessage: 'Running Julia code in REPL',
            confirmationMessages,
        }
    }
}
