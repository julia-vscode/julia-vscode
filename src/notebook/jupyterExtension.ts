import { extensions } from 'vscode'

interface IJupyterExtensionApi {
    registerNewNotebookContent(options: { defaultCellLanguage: string }): void;
}

export async function registerWithJupyter() {
    const jupyter = extensions.getExtension<IJupyterExtensionApi>(
        'ms-toolsai.jupyter'
    )
    if (!jupyter) {
        return
    }
    if (!jupyter.isActive) {
        await jupyter.activate()
    }
    jupyter.exports.registerNewNotebookContent({
        defaultCellLanguage: 'julia',
    })
}
