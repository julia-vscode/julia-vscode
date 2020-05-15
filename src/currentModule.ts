import * as vscode from "vscode";
import { ISettings } from "./settings";
import * as vslc from 'vscode-languageclient';

export class CurrentModule {
    private _languageClient: vslc.LanguageClient = undefined;
    private _activeModule: string;

    constructor(
        private _context: vscode.ExtensionContext,
        private _settings: ISettings) {
    }

    public onDidChangeConfiguration(newSettings: ISettings) {
        this._settings = newSettings;
    }

    public onNewLanguageClient(newlanguageClient) {
        this._languageClient = newlanguageClient;
    }
}
