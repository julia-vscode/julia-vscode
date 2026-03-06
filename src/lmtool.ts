import * as vscode from 'vscode'

export class LmToolFeature {
    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.lm.registerTool('run-julia-code', new RunJuliaCodeTool()))
    }

    dispose() {

    }
}

interface IRunJuliaCodeToolParameters {
    command: string;
}

export class RunJuliaCodeTool implements vscode.LanguageModelTool<IRunJuliaCodeToolParameters> {

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IRunJuliaCodeToolParameters>,
        _token: vscode.CancellationToken
    ) {
        const params = options.input as IRunJuliaCodeToolParameters

        const terminal = vscode.window.createTerminal('Language Model Tool User');
        terminal.show();
        try {
            await waitForShellIntegration(terminal, 5000);
        } catch (e) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart((e as Error).message)]);
        }

        const execution = terminal.shellIntegration!.executeCommand(params.command);
        const terminalStream = execution.read();

        let terminalResult = '';
        for await (const chunk of terminalStream) {
            terminalResult += chunk;
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(terminalResult)]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IRunJuliaCodeToolParameters>,
        _token: vscode.CancellationToken
    ) {
        const confirmationMessages = {
            title: 'Run command in terminal',
            message: new vscode.MarkdownString(
                `Run this command in a terminal?` +
                `\n\n\`\`\`\n${options.input.command}\n\`\`\`\n`
            ),
        };

        return {
            invocationMessage: `Running command in terminal`,
            confirmationMessages,
        };
    }
}
