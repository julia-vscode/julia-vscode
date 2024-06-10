// protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
//     this._launchMode = false
//     const pn = generatePipeName(uuid(), 'vsc-jl-dbg')

//     const connectedPromise = new Subject()
//     const serverListeningPromise = new Subject()

//     const server = net.createServer(socket => {
//         this._connection = createMessageConnection(
//             new StreamMessageReader(socket),
//             new StreamMessageWriter(socket)
//         )

//         this._connection.onNotification(notifyTypeStopped, (params) => this.sendEvent(new StoppedEvent(params.reason, params.threadId, params.text)))
//         this._connection.onNotification(notifyTypeOurFinished, () => this.ourFinishedEvent())

//         this._connection.listen()

//         connectedPromise.notify()
//     })

//     server.listen(pn, () => {
//         serverListeningPromise.notify()
//     })

//     await serverListeningPromise.wait()

//     replStartDebugger(pn)

//     await connectedPromise.wait()

//     // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
//     // we request them early by sending an 'initializeRequest' to the frontend.
//     // The frontend will end the configuration sequence by calling 'configurationDone' request.
//     this.sendEvent(new InitializedEvent())

//     // wait until configuration has finished (and configurationDoneRequest has been called)
//     // await this._configurationDone.wait(1000);
//     await this._configurationDone.wait()

//     await this._connection.sendNotification(notifyTypeExec, {
//         stopOnEntry: args.stopOnEntry,
//         code: args.code,
//         file: args.file,
//         compiledModulesOrFunctions: args.compiledModulesOrFunctions,
//         compiledMode: args.compiledMode
//     })

//     this.sendResponse(response)
// }


// protected async customRequest(request: string, response: any, args: any) {
//     if (request === 'setCompiledItems') {
//         await this._connection.sendNotification(notifyTypeSetCompiledItems, args)
//     } else if (request === 'setCompiledMode') {
//         await this._connection.sendNotification(notifyTypeSetCompiledMode, args)
//     }
// }
// }
