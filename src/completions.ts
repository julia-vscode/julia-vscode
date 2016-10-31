'use strict';
import { CompletionItemProvider, CompletionItem, TextDocument, Position, Range, CancellationToken, Uri } from 'vscode';
import { JuliaSocket, Request } from './server';

import * as net from 'net';

export class JuliaCompletionItemProvider implements CompletionItemProvider {
	private socket: JuliaSocket;
	public constructor(socket: JuliaSocket) {
		this.socket = socket;
	}
    public handle(result) {
        
        return result.completionitems.map((item)=>{
            return new CompletionItem(item)
        });
    }

	public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): Promise<CompletionItem[]> {
        return new Promise<CompletionItem[]> ((resolve,reject)=>{
            if (position.character <= 0) {
                return resolve();
            }
            let line = document.getText(document.lineAt(position.line).range)
            
            var req = <Request>{
                type: 'completions',
                params: {
                        line: line,
                        pos: position.character
                },
                resolve: resolve,
                handle: this.handle
            }
            this.socket.send(req)
        });
    }
}

