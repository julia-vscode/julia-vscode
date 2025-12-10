import * as vscode from 'vscode'
import { ExecutableFeature } from './executables'
import { TaskRunnerTerminal } from './taskRunnerTerminal'

// Julia/Juliaup Install commands for different platforms
const installJuliaupLinuxCommand: string = 'curl -fsSL https://install.julialang.org | sh -s -- -y'
const installJuliaupWinCommand: string = 'winget install --name Julia --id 9NJNWW8PVKMN -e -s msstore'

export async function installJuliaOrJuliaupExtension(
    executableFeature: ExecutableFeature,
    requiredChannels?: Set<string>
) {
    try {
        await executableFeature.getExecutable()
    } catch {
        const exitCode = await installJuliaOrJuliaup(executableFeature, 'julia', requiredChannels)

        if (exitCode === 0) {
            // If julia was installed but we can't find it
            if (!(await executableFeature.getExecutable())) {
                vscode.window.showInformationMessage(
                    'Julia/juliaup successfully installed. Please fully exit and restart the editor for the changes to take effect.',
                    {
                        modal: true,
                    }
                )
            } else {
                vscode.window.showInformationMessage('Julia/juliaup successfully installed.')
            }
        } else if (exitCode !== undefined) {
            vscode.window.showErrorMessage(
                'Julia/juliaup installation failed. Please check the Terminals tab for more details.',
                {
                    modal: true,
                }
            )
        }

        return
    }

    try {
        await executableFeature.getJuliaupExecutable()
    } catch {
        const showJuliaupInstallHint = vscode.workspace.getConfiguration('julia').get('juliaup.install.hint')
        if (showJuliaupInstallHint) {
            await installJuliaOrJuliaup(executableFeature, 'juliaup', requiredChannels)
        }
    }
}

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
    let message =
        'Julia is not installed. Do you want to install it automatically using juliaup or manually add the path?'
    let taskName = 'Install Julia'

    options.push(configurePath)

    // Options for Juliaup
    const doNotShow = 'Do not show again'
    if (software === 'juliaup') {
        options.pop()

        message =
            'Juliaup is the recommended Julia version manager, but it is not installed. Do you want to install it automatically?'
        taskName = 'Install Juliaup'

        options.push(doNotShow)
    }

    const choice = await vscode.window.showInformationMessage(message + channelSuffix, ...options)

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
            value: process.platform === 'win32' ? installJuliaupWinCommand : installJuliaupLinuxCommand,
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
    const exitCode = await installJuliaOrJuliaupTask(taskName, command)

    if (exitCode !== 0) {
        return exitCode
    }

    const juliaup = await executableFeature?.getJuliaupExecutableNoCache('[juliaup] ', false)
    await juliaup.addChannels(requiredChannels)

    vscode.window.showInformationMessage('Julia and the required juliaup channels are now fully installed!')
}

export async function installJuliaOrJuliaupTask(taskName: string, customCommand?: string): Promise<number | void> {
    let command = installJuliaupLinuxCommand
    let shell = 'bash'
    let shellExecutionArg = '-c'

    if (process.platform === 'win32') {
        command = installJuliaupWinCommand
        shell = 'powershell.exe'
        shellExecutionArg = '-Command'
    }

    if (customCommand) {
        command = customCommand
    }

    if (!command) {
        // this looks unintentional, so we error out early
        return 1
    }

    const args = [shellExecutionArg, command]

    const task = new TaskRunnerTerminal(taskName, shell, args, {
        env: process.env,
        echoMessage: `\n\r\x1b[30;47m * \x1b[0m ${command}\n\n\r`,
        onExitMessage(exitCode) {
            if (exitCode === 0) {
                return '\n\r\x1b[30;47m * \x1b[0m Successfully installed Juliaup/Julia. Press any key to close the terminal.\n\r'
            }
            return `\n\r\x1b[30;47m * \x1b[0m Failed to install Juliaup/Julia (exit code ${exitCode}). Press any key to close the terminal.\n\r`
        },
    })

    task.show()

    const exitCode: number | void = await new Promise((resolve) => {
        task.onDidClose((ev) => resolve(ev))
    })

    return exitCode
}
