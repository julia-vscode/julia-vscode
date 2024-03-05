import * as appInsights from 'applicationinsights'
import * as fs from 'async-file'
import * as net from 'net'
import * as path from 'path'
import { parse } from 'semver'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { onDidChangeConfig } from './extension'
import { generatePipeName } from './utils'

let enableCrashReporter: boolean = false
let enableTelemetry: boolean = false

let g_currentJuliaVersion: string = ''

let extensionClient: appInsights.TelemetryClient = undefined

let crashReporterUIVisible: boolean = false
let crashReporterQueue = []

let g_jlcrashreportingpipename: string = null

function filterTelemetry(envelope, context) {
    if (envelope.data.baseType === 'ExceptionData') {
        if (enableCrashReporter) {
            for (const i_ex in envelope.data.baseData.exceptions) {
                for (const i_sf in envelope.data.baseData.exceptions[i_ex].parsedStack) {
                    const sf = envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf]
                    envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf].assembly = ''

                    envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf].sizeInBytes = sf.method.length + sf.fileName.length + sf.assembly.length + 58 + sf.level.toString().length + sf.line.toString().length
                }
            }
            return true
        }
        else {
            return false
        }
    }
    else {
        return enableTelemetry
    }
}

function loadConfig() {
    const section = vscode.workspace.getConfiguration('julia')

    enableCrashReporter = section.get<boolean>('enableCrashReporter', false)
    enableTelemetry = section.get<boolean>('enableTelemetry', false)
}

export async function init(context: vscode.ExtensionContext) {
    loadConfig()

    context.subscriptions.push(onDidChangeConfig(event => {
        loadConfig()
    }))

    const packageJSONContent = JSON.parse(await fs.readTextFile(path.join(context.extensionPath, 'package.json')))

    const extversion = packageJSONContent.version
    const parsedExtensionVersion = parse(extversion)

    // The Application Insights Key
    let key = ''
    if (parsedExtensionVersion.patch===2) {
        // Use the production environment
        key = 'InstrumentationKey=ca1fb443-8d44-4a06-91fe-0235cfdf635f;IngestionEndpoint=https://eastus-4.in.applicationinsights.azure.com/'
    }
    else if (parsedExtensionVersion.patch===1) {
        // Use the insider environment
        key = 'InstrumentationKey=94d316b7-bba0-4d03-9525-81e25c7da22f;IngestionEndpoint=https://eastus-3.in.applicationinsights.azure.com/'
    }
    else {
        // Use the debug environment
        key = 'InstrumentationKey=82cf1bd4-8560-43ec-97a6-79847395d791;IngestionEndpoint=https://eastus-4.in.applicationinsights.azure.com/'
    }

    appInsights.setup(key)
        .setAutoDependencyCorrelation(false)
        .setAutoCollectRequests(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectExceptions(false) // TODO try to get this working
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
        .setUseDiskRetryCaching(true)
        .start()

    if (parsedExtensionVersion.patch!==1 && parsedExtensionVersion.patch!==2) {
        // Make sure we send out messages right away
        appInsights.defaultClient.config.maxBatchSize = 0
    }

    extensionClient = appInsights.defaultClient
    extensionClient.addTelemetryProcessor(filterTelemetry)
    extensionClient.commonProperties['vscodemachineid'] = vscode.env.machineId
    extensionClient.commonProperties['vscodesessionid'] = vscode.env.sessionId
    extensionClient.commonProperties['vscodeversion'] = vscode.version
    extensionClient.commonProperties['extversion'] = extversion
    extensionClient.commonProperties['juliaversion'] = g_currentJuliaVersion
    extensionClient.context.tags[extensionClient.context.keys.cloudRole] = 'Extension'
    extensionClient.context.tags[extensionClient.context.keys.cloudRoleInstance] = ''
    extensionClient.context.tags[extensionClient.context.keys.sessionId] = vscode.env.sessionId
    extensionClient.context.tags[extensionClient.context.keys.userId] = vscode.env.machineId
}

export function handleNewCrashReport(name: string, message: string, stacktrace: string, cloudRole: string) {
    if (name.startsWith('LSPrecompileFailure')) {
        vscode.window.showErrorMessage('The Julia Language Server failed to precompile. Please check the FAQ and the local output.', 'Open FAQ', 'Open Logs').then(choice => {
            if (choice === 'Open Logs') {
                vscode.commands.executeCommand('language-julia.showLanguageServerOutput')
            } else if (choice === 'Open FAQ') {
                vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://www.julia-vscode.org/docs/stable/faq'))
            }
        })
    }
    crashReporterQueue.push({
        exception: {
            name: name,
            message: message,
            stack: stacktrace
        },
        tagOverrides: {
            [extensionClient.context.keys.cloudRole]: cloudRole
        }
    })

    if (enableCrashReporter) {
        sendCrashReportQueue()
    }
    else {
        showCrashReporterUIConsent()
    }
}

export function handleNewCrashReportFromException(exception: Error, cloudRole: string) {
    crashReporterQueue.push({
        exception: exception,
        tagOverrides: {
            [extensionClient.context.keys.cloudRole]: cloudRole
        }
    })

    if (enableCrashReporter) {
        sendCrashReportQueue()
    }
    else {
        showCrashReporterUIConsent()
    }
}

export function startLsCrashServer() {

    g_jlcrashreportingpipename = generatePipeName(uuid(), 'vsc-jl-cr')

    const server = net.createServer(function (connection) {
        let accumulatingBuffer = Buffer.alloc(0)

        connection.on('data', async function (c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)])
        })

        connection.on('close', async function (had_err) {
            const replResponse = accumulatingBuffer.toString().split('\n')
            const errorMessageLines = parseInt(replResponse[2])
            const errorMessage = replResponse.slice(3, 3 + errorMessageLines).join('\n')
            const stacktrace = replResponse.slice(3 + errorMessageLines, replResponse.length - 1).join('\n')

            traceEvent('jlerror')

            handleNewCrashReport(replResponse[1], errorMessage, stacktrace, replResponse[0])
        })
    })

    server.listen(g_jlcrashreportingpipename)
}

export function getCrashReportingPipename() {
    return g_jlcrashreportingpipename
}

export function traceEvent(message) {
    extensionClient.trackEvent({ name: message })
}

export function tracePackageLoadError(packagename, message) {
    extensionClient.trackTrace({ message: `Package ${packagename} crashed.\n\n${message}` })
}

export function traceTrace(msg: appInsights.Contracts.TraceTelemetry) {
    extensionClient.trackTrace(msg)
}

function sendCrashReportQueue() {
    const own_copy = crashReporterQueue
    crashReporterQueue = []
    for (const i of own_copy) {
        extensionClient.track(i, appInsights.Contracts.TelemetryType.Exception)
    }
    extensionClient.flush()
}

async function showCrashReporterUIConsent() {
    if (crashReporterUIVisible || vscode.workspace.getConfiguration('julia').get<boolean>('enableCrashReporter') === false) {
        return
    }
    else {
        crashReporterUIVisible = true
        try {
            const agree = 'Yes'
            const agreeAlways = 'Yes, always'
            const disagree = 'No, never'
            const choice = await vscode.window.showInformationMessage('The Julia language extension crashed. Do you want to send more information about the problem to the development team? Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more about how we use crash reports and what data will be transmitted.', agree, agreeAlways, disagree)
            if (choice === disagree) {
                vscode.workspace.getConfiguration('julia').update('enableCrashReporter', false, vscode.ConfigurationTarget.Global)
            }
            if (choice === agreeAlways) {
                vscode.workspace.getConfiguration('julia').update('enableCrashReporter', true, vscode.ConfigurationTarget.Global)
            }
            if (choice === agree || choice === agreeAlways) {
                sendCrashReportQueue()
            }
        }
        finally {
            crashReporterUIVisible = false
        }
    }
}

export function setCurrentJuliaVersion(version: string) {
    g_currentJuliaVersion = version

    if (extensionClient) {
        extensionClient.commonProperties['juliaversion'] = g_currentJuliaVersion
    }
}
