import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as vslc from 'vscode-languageclient';
import * as settings from './settings';
let appInsights = require('applicationinsights');
import {generatePipeName} from './utils';

let enableExtendedCrashReports: boolean = false;
let enableTelemetry: boolean = false;

let extensionClient

function filterTelemetry ( envelope, context ) {
    if (enableTelemetry) {
        if (envelope.tags["ai.cloud.roleInstance"] !== undefined) {
            envelope.tags["ai.cloud.roleInstance"] = "";
        }

        if (!enableExtendedCrashReports) {
            if (envelope.data.baseType=="ExceptionData") {
                for (let i in envelope.data.baseData.exceptions) {
                    envelope.data.baseData.exceptions[i].hasFullStack = false;
                    envelope.data.baseData.exceptions[i].message = "AnonymisedError";
                    envelope.data.baseData.exceptions[i].parsedStack = undefined;
                    envelope.data.baseData.exceptions[i].typeName = "AnonymisedError";
                }
            }
        }
        return true
    }
    else {
        return false;
    }
}

function loadConfig() {
    let section = vscode.workspace.getConfiguration('julia');

    enableExtendedCrashReports = section.get<boolean>('enableExtendedCrashReports', false)
    enableTelemetry = section.get<boolean>('enableTelemetry', false);
}

export function init() {
    loadConfig();

    if (enableExtendedCrashReports===null) {
        enableExtendedCrashReports = false;
    }

    let extversion: String = vscode.extensions.getExtension('julialang.language-julia').packageJSON.version;

    // The Application Insights Key
    let key = '';
    if (vscode.env.machineId == "someValue.machineId") {
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
        .setAutoCollectExceptions(false) // TODO try to get this working
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
        .setUseDiskRetryCaching(true)
        .start();

    
    extensionClient = appInsights.defaultClient;
    extensionClient.addTelemetryProcessor(filterTelemetry);
    extensionClient.commonProperties["vscodemachineid"] = vscode.env.machineId;
    extensionClient.commonProperties["vscodesessionid"] = vscode.env.sessionId;
    extensionClient.commonProperties["vscodeversion"] = vscode.version;
    extensionClient.commonProperties["extversion"] = extversion;
    extensionClient.context.tags[extensionClient.context.keys.cloudRole] = "Extension";
}

export function startLsCrashServer() {

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

            extensionClient.track({exception: {name: replResponse[0], message: replResponse[1], stack: stacktrace}}, appInsights.Contracts.TelemetryType.Exception)
        });
    });

    server.listen(pipe_path);
}

export function traceEvent(message) {
    extensionClient.trackEvent({name: message});
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {
    loadConfig();
}
