import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as vslc from 'vscode-languageclient';
import * as settings from './settings';
import * as fs from 'async-file';
let appInsights = require('applicationinsights');
import {generatePipeName} from './utils';

let enableCrashReporter: boolean = false;
let enableTelemetry: boolean = false;

let g_currentJuliaVersion: string = "";

let extensionClient

let crashReporterUIVisible: boolean = false;
let crashReporterQueue = []

function filterTelemetry(envelope, context) {
    if (envelope.data.baseType == "ExceptionData") {
        if (enableCrashReporter) {
            for (let i_ex in envelope.data.baseData.exceptions) {
                for (let i_sf in envelope.data.baseData.exceptions[i_ex].parsedStack) {
                    let sf = envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf]
                    envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf].assembly = "";

                    envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf].sizeInBytes = sf.method.length + sf.fileName.length + sf.assembly.length + 58 + sf.level.toString().length + sf.line.toString().length
                }
            }
            return true;
        }
        else {
            return false;
        }
    }
    else {
        return enableTelemetry;
    }
}

function loadConfig() {
    let section = vscode.workspace.getConfiguration('julia');

    enableCrashReporter = section.get<boolean>('enableCrashReporter', false)
    enableTelemetry = section.get<boolean>('enableTelemetry', false);
}

export async function init(context: vscode.ExtensionContext) {
    loadConfig();

    let packageJSONContent = JSON.parse(await fs.readTextFile(path.join(context.extensionPath, 'package.json')));

    let extversion = packageJSONContent.version;
    let previewVersion = packageJSONContent.preview;

    // The Application Insights Key
    let key = '';
    if (vscode.env.machineId == "someValue.machineId") {
        // Use the debug environment
        key = '82cf1bd4-8560-43ec-97a6-79847395d791';
    }
    else if (!previewVersion) {
        // Use the production environment
        key = 'ca1fb443-8d44-4a06-91fe-0235cfdf635f';
    }
    else {
        // Use the dev environment
        key = '94d316b7-bba0-4d03-9525-81e25c7da22f';
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

    if (vscode.env.machineId == "someValue.machineId") {
        // Make sure we send out messages right away
        appInsights.defaultClient.config.maxBatchSize = 0;
    }
    
    extensionClient = appInsights.defaultClient;
    extensionClient.addTelemetryProcessor(filterTelemetry);
    extensionClient.commonProperties["vscodemachineid"] = vscode.env.machineId;
    extensionClient.commonProperties["vscodesessionid"] = vscode.env.sessionId;
    extensionClient.commonProperties["vscodeversion"] = vscode.version;
    extensionClient.commonProperties["extversion"] = extversion;
    extensionClient.commonProperties["juliaversion"] = g_currentJuliaVersion;
    extensionClient.context.tags[extensionClient.context.keys.cloudRole] = "Extension";
    extensionClient.context.tags[extensionClient.context.keys.cloudRoleInstance] = "";
    extensionClient.context.tags[extensionClient.context.keys.sessionId] = vscode.env.sessionId;
    extensionClient.context.tags[extensionClient.context.keys.userId] = vscode.env.machineId;
}

export function handleNewCrashReport(name: string, message: string, stacktrace: string) {
    crashReporterQueue.push({exception: {name: name, message: message, stack: stacktrace}});  

    if (enableCrashReporter) {
        sendCrashReportQueue();
    }
    else {
        showCrashReporterUIConsent();
    }
}

export function startLsCrashServer() {

    let pipe_path = generatePipeName(process.pid.toString(), 'vscode-language-julia-lscrashreports');

    let server = net.createServer(function (connection) {
        let accumulatingBuffer = Buffer.alloc(0);

        connection.on('data', async function (c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
        });

        connection.on('close', async function (had_err) {
            let replResponse = accumulatingBuffer.toString().split("\n")
            let errorMessageLines = parseInt(replResponse[1])
            let errorMessage = replResponse.slice(2, 2 + errorMessageLines).join('\n');
            let stacktrace = replResponse.slice(2 + errorMessageLines,replResponse.length-1).join('\n');

            traceEvent('lserror');

            handleNewCrashReport(replResponse[0], errorMessage, stacktrace);
        });
    });

    server.listen(pipe_path);

    return pipe_path;
}

export function traceEvent(message) {
    extensionClient.trackEvent({name: message});
}

export function tracePackageLoadError(packagename, message) {
    extensionClient.trackTrace({message: `Package ${packagename} crashed.\n\n${message}`})
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {
    loadConfig();
}

function sendCrashReportQueue() {
    var own_copy = crashReporterQueue;
    crashReporterQueue = [];
    for (var i of own_copy) {
        extensionClient.track(i, appInsights.Contracts.TelemetryType.Exception)
    }
}

async function showCrashReporterUIConsent() {
    if (crashReporterUIVisible || vscode.workspace.getConfiguration('julia').get<boolean>('enableCrashReporter')===false) {
        return;
    }
    else {
        crashReporterUIVisible = true;
        try {
            var choice = await vscode.window.showInformationMessage("The julia language extension crashed. Do you want to send more information about the problem to the development team?", 'Agree', 'Always Agree');

            if (choice=='Always Agree') {
                vscode.workspace.getConfiguration('julia').update('enableCrashReporter', true, true);
            }

            if (choice=='Agree' || choice=='Always Agree') {
                sendCrashReportQueue();
            }
        }
        finally {
            crashReporterUIVisible = false;
        }
    }
}

export function setCurrentJuliaVersion(version: string) {
    g_currentJuliaVersion = version;

    if (extensionClient) {
        extensionClient.commonProperties["juliaversion"] = g_currentJuliaVersion;
    }
}
