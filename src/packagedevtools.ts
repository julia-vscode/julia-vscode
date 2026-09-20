import * as path from 'path'
import * as vscode from 'vscode'
import { ExecutableFeature, JuliaNotFoundError } from './executables'
import { getCustomEnvironmentVariables, registerCommand } from './utils'

export class JuliaPackageDevFeature {
    constructor(
        private context: vscode.ExtensionContext,
        private ExecutableFeature: ExecutableFeature
    ) {
        this.context.subscriptions.push(
            registerCommand('language-julia.tagNewPackageVersion', async () => await this.tagNewPackageVersion())
        )
    }

    /**
     * Checks a GitHub access token against the REST API.
     *
     * Returns the account's login name if the token is good, or `undefined` if GitHub
     * rejected it with a 401. Any other failure (no network, GitHub down, rate limit)
     * throws, so that it doesn't get misreported to the user as an authentication problem.
     */
    private async probeGitHubToken(accessToken: string): Promise<string | undefined> {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'julia-vscode',
            },
        })

        if (response.status === 401) {
            return undefined
        }

        if (!response.ok) {
            throw new Error(`GitHub returned ${response.status} ${response.statusText} for /user.`)
        }

        const login = ((await response.json()) as { login?: string }).login

        if (typeof login !== 'string') {
            throw new Error('GitHub returned a /user response without a login field.')
        }

        return login
    }

    /**
     * Obtains a GitHub access token that is known to work.
     *
     * VS Code hands out whatever session it has cached without revalidating it, so a token
     * that was revoked server-side (OAuth app authorization removed, password reset, org
     * SSO lapsed) still comes back from `getSession`. Handing such a token to PkgDev makes
     * the tagging script die with an opaque `401 Bad credentials` Julia stacktrace in a
     * terminal we no longer control, so check it here and re-authenticate instead.
     *
     * Returns `undefined` if no usable token could be obtained, in which case the user has
     * already been told why.
     */
    private async getGitHubCredentials(): Promise<{ accessToken: string; account: string } | undefined> {
        let session: vscode.AuthenticationSession
        try {
            session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true })
        } catch {
            // The user dismissed the sign in prompt.
            return undefined
        }

        let account = await this.probeGitHubToken(session.accessToken)

        if (account !== undefined) {
            return { accessToken: session.accessToken, account }
        }

        let freshSession: vscode.AuthenticationSession
        try {
            freshSession = await vscode.authentication.getSession('github', ['repo'], { forceNewSession: true })
        } catch {
            // The user dismissed the sign in prompt.
            return undefined
        }

        account = await this.probeGitHubToken(freshSession.accessToken)

        if (account !== undefined) {
            return { accessToken: freshSession.accessToken, account }
        }

        await vscode.window.showErrorMessage(
            'GitHub rejected the credentials for your VS Code GitHub account, so the new package version cannot be tagged. ' +
                'Sign out of the account in the Accounts menu, sign back in and try again. ' +
                'If your organization uses SAML single sign on, you may also need to authorize the VS Code OAuth app for that organization.'
        )

        return undefined
    }

    private async tagNewPackageVersion() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            let resultVersion = await vscode.window.showQuickPick(['Next', 'Major', 'Minor', 'Patch', 'Custom'], {
                placeHolder: 'Please select the version to be tagged.',
            })

            if (resultVersion === 'Custom') {
                resultVersion = await vscode.window.showInputBox({
                    prompt: 'Please enter the version number you want to tag.',
                })
            }

            if (resultVersion !== undefined) {
                const releaseNotes = await vscode.window.showInputBox({
                    prompt: 'Please enter the release notes for this version.',
                    value: 'See the changelog for details.',
                })

                if (releaseNotes !== undefined) {
                    const credentials = await this.getGitHubCredentials()

                    if (credentials === undefined) {
                        return
                    }

                    const { accessToken, account } = credentials

                    let juliaExecutable
                    try {
                        juliaExecutable = await this.ExecutableFeature.getExecutable()
                    } catch (err) {
                        if (err instanceof JuliaNotFoundError) {
                            return
                        }
                        throw err
                    }

                    if (juliaExecutable.getVersion().compare('1.6.0') >= 0) {
                        const newTerm = vscode.window.createTerminal({
                            name: 'Julia: Tag a new package version',
                            shellPath: juliaExecutable.command,
                            shellArgs: [
                                ...juliaExecutable.args,
                                path.join(
                                    this.context.extensionPath,
                                    'scripts',
                                    'packagedev',
                                    'tagnewpackageversion.jl'
                                ),
                                accessToken,
                                account,
                                resultVersion,
                                releaseNotes,
                            ],
                            cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
                            env: getCustomEnvironmentVariables(),
                        })

                        newTerm.show(true)
                    } else {
                        await vscode.window.showErrorMessage(
                            'Tagging package versions is only supported on Julia 1.6 and newer.'
                        )
                    }
                }
            }
        }
    }

    public dispose() {}
}
