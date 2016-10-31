'use strict';
import { HoverProvider, Hover, TextDocument, Position, Range, CancellationToken } from 'vscode';
import { JuliaSocket, Request } from './server';

import * as net from 'net';

export class JuliaHoverProvider implements HoverProvider {
	private socket: JuliaSocket;

	public constructor(socket: JuliaSocket) {
		this.socket = socket;
	}

    public handle(result) {
        return new Hover({language: "julia", value:result.doc})
    }

	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover> {
        return new Promise<Hover> ((resolve,reject)=>{
            let text = document.getText(document.getWordRangeAtPosition(position))

            var req = <Request>{
                type: 'hover',
                params: text,
                resolve: resolve,
                handle: this.handle
            }
            this.socket.send(req)
        });
    }
}

