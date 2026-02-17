import * as vscode from 'vscode'
import { ExecutableFeature } from './executables'
import { TaskRunner } from './taskRunnerTerminal'

// Julia/Juliaup Install commands for different platforms
const linuxInstallComamnds: string[] = [
    'set -o pipefail && wget -q -O - https://install.julialang.org | sh -s -- -y',
    'set -o pipefail && curl -fsSL https://install.julialang.org | sh -s -- -y',
]
const windowsInstallComamnds: string[] = [
    'winget install --name Julia --id 9NJNWW8PVKMN -e -s msstore',
    'Add-AppxPackage -AppInstallerFile https://install.julialang.org/Julia.appinstaller',
    'winget install --id Julialang.Julia -e -s winget',
]

export async function installJuliaOrJuliaup(
    executableFeature: ExecutableFeature,
    software: string = 'julia',
    requiredChannels?: Set<string>
): Promise<number | void> {
    // software can be 'julia' or 'juliaup'

    const download = 'Download and Install'
    const customCommand = 'Custom Command'
    const options: string[] = [download, customCommand]

    let channelSuffix = ''
    if (requiredChannels?.size > 0) {
        channelSuffix = ` We will also install the following channels as per your configuration: ${[...requiredChannels].join(', ')}`
    }
    // Options for Julia
    const configurePath = 'Configure path'
    let message = 'Julia is not installed. Do you want to install it using juliaup, the official Julia version manager?'

    options.push(configurePath)

    // Options for Juliaup
    const doNotShow = 'Do not show again'
    if (software === 'juliaup') {
        options.pop()

        message =
            'Juliaup is the recommended Julia version manager, but it is not installed. Do you want to install it automatically?'

        options.push(doNotShow)
    }

    const choice = await vscode.window.showInformationMessage(
        'Automatically install Julia?',
        { modal: true, detail: message + channelSuffix },
        ...options
    )

    if (choice === configurePath) {
        vscode.commands.executeCommand('workbench.action.openSettings', 'julia.executablePath')
        return
    } else if (choice === doNotShow) {
        vscode.workspace
            .getConfiguration('julia')
            .update('juliaup.install.hint', false, vscode.ConfigurationTarget.Global)
        return
    } else if (!choice) {
        return
    }

    let command = undefined
    if (choice === customCommand) {
        command = await vscode.window.showInputBox({
            value: process.platform === 'win32' ? windowsInstallComamnds[0] : linuxInstallComamnds[0],
            placeHolder: 'Enter command',
            validateInput: (value) => {
                // return null if validates
                return value.trim() !== '' ? null : 'Command is not valid!'
            },
        })

        if (!command) {
            // We return 1 as an exit code
            return 1
        }
    }
    const exitCode = await installJuliaOrJuliaupTask(executableFeature.taskRunner, command)

    if (exitCode !== 0) {
        return exitCode
    }

    const juliaup = await executableFeature?.getJuliaupExecutableNoCache(false)
    try {
        await juliaup.addChannels(requiredChannels, { show: true })
        return 0
    } catch {
        return 1
    }
}

export async function installJuliaOrJuliaupTask(
    taskRunner: TaskRunner,
    customCommand?: string
): Promise<number | void> {
    let commands = linuxInstallComamnds
    let shell = 'bash'
    let shellExecutionArg = '-c'

    if (process.platform === 'win32') {
        commands = windowsInstallComamnds
        shell = 'powershell.exe'
        shellExecutionArg = '-Command'
    }

    if (customCommand) {
        commands = [customCommand]
    }

    if (!commands[0]) {
        // this looks unintentional, so we error out early
        return 1
    }

    let exitCode: number | void = 1

    for (const command of commands) {
        const isLast = command === commands[commands.length - 1]

        const args = [shellExecutionArg, command]

        exitCode = await taskRunner.run(shell, args, {
            env: process.env,
            echoMessage: `\n\r\x1b[30;47m * \x1b[0m ${commands}\n\n\r`,
            onExitMessage(exitCode) {
                if (exitCode === 0) {
                    return '\n\r\x1b[30;47m * \x1b[0m Successfully installed Juliaup/Julia. Press any key to close the terminal.\n\r\n\r'
                }

                const onDoneMsg = isLast
                    ? `Failed to install Juliaup/Julia (exit code ${exitCode}). Press any key to close the terminal.`
                    : `Command failed, proceeding to next option...`
                return `\n\r\x1b[30;47m * \x1b[0m ${onDoneMsg}\n\r\n\r`
            },
        })

        if (exitCode === 0) {
            return exitCode
        }
    }

    return exitCode
}
