'use strict';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as net from 'net';

let jproc: cp.ChildProcess;
let jsock: net.Socket;
let requests = new Map<number,Request>();

export interface Request {
    id?: number,
    type: string,
    params,
    resolve,
    handle
}

export class JuliaServer extends vscode.Disposable {
    public proc
    public kill(){ 
        killJuliaServer();
    }
    public restart() {
        this.kill();
        startJuliaServer();
    }
    public constructor(context: vscode.ExtensionContext) {
        super(killJuliaServer)
        context.subscriptions.push(this)
        this.proc = startJuliaServer()
    }
}

function killJuliaServer() {
    try { 
        if (jproc) {
            jproc.kill('SIGKILL');
        }
    }
    catch (err) {
        jproc=null;
    }
}

export function startJuliaServer(){
    try {
        let jbin = vscode.workspace.getConfiguration('julia').get<string>("validate.executablePath",'julia');
        let jserver = vscode.extensions.getExtension("julialang.language-julia").extensionPath+"/jl/server.jl"

        jproc = cp.spawn(jbin,[jserver]);
        jproc.stdout.on("data",(dat)=>{
            console.log(dat);
        })
        jproc.stderr.on("error",(err)=>{console.log(err)})
        return jproc
    }
    catch (err) {
        console.log(err);
    }
}


export class JuliaSocket extends vscode.Disposable {
    private requestid: number = 0;
    public socket: net.Socket;
    public on: boolean = false;
    public constructor(context: vscode.ExtensionContext) {
        super(closesocket)
        context.subscriptions.push(this)
        this.socket = new net.Socket
        this.socket.on('data',this.receive)
        this.socket.on('error',(data)=>{console.log(data.toString())})
    }

    public send(req: Request){
        if (!this.on) {
            this.connect()
        }
        this.requestid++
        req.id = this.requestid
        requests.set(this.requestid,req)
        
        this.socket.write(JSON.stringify({
                type: req.type,
                params: req.params,
                id: req.id
            })+'\n')
    }

    public receive(data) {
        let result = JSON.parse(data.toString())
        let request = requests.get(result.id)

        request.resolve(request.handle(result))
    }

    public connect() {
        try {
            this.socket.connect("juliaserver"+jproc.pid);
            this.on = true;
        }
        catch (err) {
            console.log("err")
        }
    }
}

function closesocket() { 
    jsock.destroy();
}
