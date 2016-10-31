'use strict';
import { DefinitionProvider, Definition, TextDocument, Position, Range, CancellationToken, Uri, Location } from 'vscode';
import { JuliaSocket, Request } from './server';

import * as net from 'net';

export class JuliaDefinitionProvider implements DefinitionProvider {
	private socket: JuliaSocket;

	public constructor(socket: JuliaSocket) {
		this.socket = socket;
	}

    public handle(result) {
        return result.defs.map((def)=>{
            return new Location(Uri.file(def[0]), new Range(def[1]-1, 0, def[1]-1, 0));
        });
    }

	public provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Definition> {
        return new Promise<Definition> ((resolve,reject)=>{
            if (position.character <= 0) {
                return resolve();
            }
            let line = document.getText(document.lineAt(position.line).range)
            
            var req = <Request>{
                type: 'definition',
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

