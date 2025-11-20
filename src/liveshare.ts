import * as vsls from 'vsls'
import * as vscode from 'vscode'

const SERVICE_ID = 'language-julia'

export class JuliaLiveShareService {
    vslsApi: vsls.LiveShare
    context: vscode.ExtensionContext
    hostService: vsls.SharedService
    guestService: vsls.SharedServiceProxy

    constructor(context: vscode.ExtensionContext) {
        this.context = context
    }

    async init() {
        this.vslsApi = await vsls.getApi()

        // notification and request handlers are registered by other components of the extension
        this.hostService = await this.vslsApi.shareService(SERVICE_ID)
        this.guestService = await this.vslsApi.getSharedService(SERVICE_ID)

        if (this.hostService === null || this.guestService === null) {
            vscode.window.showErrorMessage('Julia: Could not initialize live share service.')
        }
    }

    dispose() {}
}
