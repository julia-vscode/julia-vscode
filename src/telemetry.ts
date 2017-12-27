import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as vslc from 'vscode-languageclient';
let appInsights = require('applicationinsights');
import {generatePipeName} from './utils';

export function init() {
    let extversion: String = vscode.extensions.getExtension('julialang.language-julia').packageJSON.version;

    // The Application Insights Key
    let key = '';
    if (vscode.env.machineId=="someValue.machineId") {
        // Use the debug environment
        key = '82cf1bd4-8560-43ec-97a6-79847395d791';
    }
    else if (extversion.includes('-')) {
        // Use the dev environment
        key = '94d316b7-bba0-4d03-9525-81e25c7da22f';
    }
    else {
        // Use the production environment
        key = 'ca1fb443-8d44-4a06-91fe-0235cfdf635f';
    }

    appInsights.setup(key)
        .setAutoDependencyCorrelation(false)
        .setAutoCollectRequests(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
        .setUseDiskRetryCaching(true)
        .start();

    appInsights.defaultClient.commonProperties["vscodemachineid"] = vscode.env.machineId;
    appInsights.defaultClient.commonProperties["vscodesessionid"] = vscode.env.sessionId;
    appInsights.defaultClient.commonProperties["vscodeversion"] = vscode.version;
    appInsights.defaultClient.commonProperties["extversion"] = extversion;

    return appInsights.defaultClient;
}

export function startLsCrashServer(client) {

    let pipe_path = generatePipeName(process.pid.toString(), 'vscode-language-julia-lscrashreports');

    let server = net.createServer(function (connection) {
        let accumulatingBuffer = new Buffer(0);

        connection.on('data', async function (c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
        });

        connection.on('close', async function (had_err) {
            let bufferResult = accumulatingBuffer.toString()
            let replResponse = accumulatingBuffer.toString().split("\n")
            let stacktrace = replResponse.slice(2,replResponse.length-1).join('\n');

            client.track({exception: {name: replResponse[0], message: replResponse[1], stack: stacktrace}}, appInsights.Contracts.TelemetryType.Exception)
        });
    });

    server.listen(pipe_path);
}

export function traceEvent(client, message) {
    client.trackEvent({name: message});
}
