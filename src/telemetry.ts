import * as appInsights from 'applicationinsights'
import * as net from 'net'
import { parse } from 'semver'
import { v4 as uuidv4 } from 'uuid'
import * as vscode from 'vscode'
import { generatePipeName, onEvent } from './utils'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { SeverityNumber } from '@opentelemetry/api-logs'
import {
    context,
    trace,
    TraceFlags,
    HrTime,
    SpanContext,
    SpanKind,
    SpanStatusCode,
    Attributes,
} from '@opentelemetry/api'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

let enableCrashReporter: boolean = false
let enableTelemetry: boolean = false

let g_currentJuliaVersion: string = ''

let extensionClient: appInsights.TelemetryClient = undefined

let crashReporterUIVisible: boolean = false
let crashReporterQueue = []

let g_jlcrashreportingpipename: string = null

let g_prereleaseExtension: boolean = false

const otlpExporter: OTLPTraceExporter = new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces', // url is optional and can be omitted - default is http://localhost:4318/v1/traces
    concurrencyLimit: 10, // an optional limit on pending requests
})

// Resource describing the language server as the source of the spans we forward. Shared by the
// spans built in `traceRequest` and the logs emitted in `traceLog`.
const lsResource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'LS',
    [ATTR_SERVICE_VERSION]: '1.218',
})

const otlpLogExporter: OTLPLogExporter = new OTLPLogExporter({
    url: 'http://localhost:4318/v1/logs', // default is http://localhost:4318/v1/logs
    concurrencyLimit: 10,
})

const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(otlpLogExporter)],
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'LS',
        [ATTR_SERVICE_VERSION]: '1.218',
    }),
})

const otLogger = loggerProvider.getLogger('julia-vscode-extension')

function filterTelemetry(envelope) {
    if (envelope.data.baseType === 'ExceptionData') {
        if (enableCrashReporter) {
            for (const i_ex in envelope.data.baseData.exceptions) {
                for (const i_sf in envelope.data.baseData.exceptions[i_ex].parsedStack) {
                    const sf = envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf]
                    envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf].assembly = ''

                    envelope.data.baseData.exceptions[i_ex].parsedStack[i_sf].sizeInBytes =
                        sf.method.length +
                        sf.fileName.length +
                        sf.assembly.length +
                        58 +
                        sf.level.toString().length +
                        sf.line.toString().length
                }
            }
            return true
        } else {
            return false
        }
    } else {
        return enableTelemetry
    }
}

function loadConfig() {
    const section = vscode.workspace.getConfiguration('julia')

    enableCrashReporter = section.get<boolean>('enableCrashReporter', false)
    enableTelemetry = section.get<boolean>('enableTelemetry', false)
}

export function init(context: vscode.ExtensionContext) {
    loadConfig()
    context.subscriptions.push(
        onEvent(vscode.workspace.onDidChangeConfiguration, () => {
            loadConfig()
        })
    )

    const extversion: string = context.extension.packageJSON.version
    const parsedExtensionVersion = parse(extversion)

    // The Application Insights Key
    let key: string
    if (parsedExtensionVersion.patch === 2) {
        // Use the production environment
        key =
            'InstrumentationKey=ca1fb443-8d44-4a06-91fe-0235cfdf635f;IngestionEndpoint=https://eastus-4.in.applicationinsights.azure.com/'
    } else if (parsedExtensionVersion.patch === 1) {
        // Use the insider environment
        key =
            'InstrumentationKey=94d316b7-bba0-4d03-9525-81e25c7da22f;IngestionEndpoint=https://eastus-3.in.applicationinsights.azure.com/'
        g_prereleaseExtension = true
    } else {
        // Use the debug environment
        key =
            'InstrumentationKey=82cf1bd4-8560-43ec-97a6-79847395d791;IngestionEndpoint=https://eastus-4.in.applicationinsights.azure.com/'
        g_prereleaseExtension = true
    }

    appInsights
        .setup(key)
        .setAutoDependencyCorrelation(false)
        .setAutoCollectRequests(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectExceptions(false) // TODO try to get this working
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
        .setUseDiskRetryCaching(true)
        .start()

    if (parsedExtensionVersion.patch !== 1 && parsedExtensionVersion.patch !== 2) {
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

    const logger = vscode.env.createTelemetryLogger({
        sendEventData: () => {},
        sendErrorData: (error: Error) => {
            handleNewCrashReportFromException(error, 'Extension')
        },
    })
    context.subscriptions.push(logger)
}

export function handleNewCrashReport(name: string, message: string, stacktrace: string, cloudRole: string) {
    if (name.startsWith('LSPrecompileFailure')) {
        vscode.window
            .showErrorMessage(
                'The Julia Language Server failed to precompile. Please check the FAQ and the local output.',
                'Open FAQ',
                'Open Logs'
            )
            .then((choice) => {
                if (choice === 'Open Logs') {
                    vscode.commands.executeCommand('language-julia.showLanguageServerOutput')
                } else if (choice === 'Open FAQ') {
                    vscode.commands.executeCommand(
                        'vscode.open',
                        vscode.Uri.parse('https://www.julia-vscode.org/docs/stable/faq')
                    )
                }
            })
    }
    crashReporterQueue.push({
        exception: {
            name: name,
            message: message,
            stack: stacktrace,
        },
        tagOverrides: {
            [extensionClient.context.keys.cloudRole]: cloudRole,
        },
    })

    if (enableCrashReporter) {
        sendCrashReportQueue()
    } else {
        showCrashReporterUIConsent()
    }
}

export function handleNewCrashReportFromException(error: Error, cloudRole: string) {
    crashReporterQueue.push({
        exception: error,
        tagOverrides: {
            [extensionClient.context.keys.cloudRole]: cloudRole,
        },
    })

    if (enableCrashReporter) {
        sendCrashReportQueue()
    } else {
        showCrashReporterUIConsent()
    }
}

export function startLsCrashServer() {
    g_jlcrashreportingpipename = generatePipeName(uuidv4(), 'vsc-jl-cr')

    const server = net.createServer(function (connection) {
        let accumulatingBuffer = Buffer.alloc(0)

        connection.on('data', async function (c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)])
        })

        connection.on('close', async function () {
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

// Convert an OpenTelemetry `HrTime` pair `[seconds, nanoseconds]` into a `Date`. This is lossy
// (millisecond resolution) and is only used for the legacy Application Insights APIs that
// require a `Date`; the OpenTelemetry SDK is always given the full-resolution `HrTime`.
function hrTimeToDate(time: HrTime): Date {
    return new Date(time[0] * 1000 + time[1] / 1e6)
}

// Add a nanosecond duration to an `HrTime`, returning a new normalized `HrTime` pair. Keeps
// full nanosecond resolution by doing the arithmetic on the nanosecond component in integers.
function hrTimeAddNanos(time: HrTime, durationNanos: number): HrTime {
    const totalNanos = time[1] + durationNanos
    return [time[0] + Math.floor(totalNanos / 1e9), totalNanos % 1e9]
}

export function traceRequest(
    spanId,
    parentId,
    traceId,
    name,
    time: HrTime,
    durationNanos,
    attributes: Attributes,
    cloudRole
) {
    if (g_prereleaseExtension) {
        extensionClient.trackRequest({
            name: name,
            url: name,
            time: hrTimeToDate(time),
            duration: durationNanos / 1e6,
            resultCode: 0,
            success: true,
            tagOverrides: {
                [extensionClient.context.keys.cloudRole]: cloudRole,
                [extensionClient.context.keys.operationName]: name,
                [extensionClient.context.keys.operationId]: spanId,
                ...(parentId ? { [extensionClient.context.keys.operationParentId]: parentId } : {}),
            },
        })
    }

    // Build the span explicitly from the ids and timing the language server already assigned and
    // hand it straight to the OTLP exporter. This avoids the SDK's tracer/context machinery, which
    // would mint its own random ids, letting us set the trace id, span id and parent span id
    // verbatim so child spans reference the correct parent.
    const spanContext: SpanContext = {
        traceId: traceId,
        spanId: spanId,
        traceFlags: TraceFlags.SAMPLED,
    }

    const span: ReadableSpan = {
        name: name,
        kind: SpanKind.SERVER,
        spanContext: () => spanContext,
        parentSpanContext: parentId
            ? { traceId: traceId, spanId: parentId, traceFlags: TraceFlags.SAMPLED }
            : undefined,
        startTime: time,
        endTime: hrTimeAddNanos(time, durationNanos),
        status: { code: SpanStatusCode.OK },
        attributes: attributes ?? {},
        links: [],
        events: [],
        duration: hrTimeAddNanos([0, 0], durationNanos),
        ended: true,
        resource: lsResource,
        instrumentationScope: { name: 'julia-vscode-extension' },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
    }

    otlpExporter.export([span], () => {})
}

export function traceLog(
    spanId,
    parentSpanId,
    traceId,
    message,
    severity,
    time: HrTime,
    cloudRole,
    attributes?: Attributes
) {
    if (g_prereleaseExtension) {
        extensionClient.trackTrace({
            message: message,
            time: hrTimeToDate(time),
            properties: attributes as Record<string, string> | undefined,
            tagOverrides: {
                [extensionClient.context.keys.cloudRole]: cloudRole,
                // App Insights uses the operation id as the trace id that groups a whole
                // operation tree, so use the trace id here and the immediate parent as the
                // parent operation id, keeping logs correlated with the request spans.
                [extensionClient.context.keys.operationId]: traceId ?? spanId,
                ...(parentSpanId ? { [extensionClient.context.keys.operationParentId]: parentSpanId } : {}),
            },
        })

        // Emit the log via the OpenTelemetry logs provider as well, recording it as a proper
        // log record correlated to the trace it belongs to. As in `traceRequest`, the trace id
        // is the stable trace id (shared by every span in the tree) and the parent span id is
        // the immediate parent span, so the log is associated with the right
        // request/derived-function span.
        const otTraceId = traceId ?? spanId
        const otSpanId = parentSpanId ?? traceId ?? spanId
        const logContext = trace.setSpanContext(context.active(), {
            traceId: otTraceId,
            spanId: otSpanId,
            traceFlags: TraceFlags.SAMPLED,
            isRemote: true,
        })

        otLogger.emit({
            body: message,
            timestamp: time,
            severityText: severity,
            severityNumber: mapSeverity(severity),
            attributes: {
                'service.cloud_role': cloudRole,
                ...attributes,
            },
            context: logContext,
        })
    }
}

function mapSeverity(severity: string): SeverityNumber {
    switch ((severity ?? '').toLowerCase()) {
        case 'trace':
            return SeverityNumber.TRACE
        case 'debug':
            return SeverityNumber.DEBUG
        case 'info':
            return SeverityNumber.INFO
        case 'warn':
        case 'warning':
            return SeverityNumber.WARN
        case 'error':
            return SeverityNumber.ERROR
        case 'fatal':
            return SeverityNumber.FATAL
        default:
            return SeverityNumber.UNSPECIFIED
    }
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
    if (
        crashReporterUIVisible ||
        vscode.workspace.getConfiguration('julia').get<boolean>('enableCrashReporter') === false
    ) {
        return
    } else {
        crashReporterUIVisible = true
        try {
            const agree = 'Yes'
            const agreeAlways = 'Yes, always'
            const disagree = 'No, never'
            const choice = await vscode.window.showInformationMessage(
                'The Julia language extension crashed. Do you want to send more information about the problem to the development team? Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more about how we use crash reports and what data will be transmitted.',
                agree,
                agreeAlways,
                disagree
            )
            if (choice === disagree) {
                vscode.workspace
                    .getConfiguration('julia')
                    .update('enableCrashReporter', false, vscode.ConfigurationTarget.Global)
            }
            if (choice === agreeAlways) {
                vscode.workspace
                    .getConfiguration('julia')
                    .update('enableCrashReporter', true, vscode.ConfigurationTarget.Global)
            }
            if (choice === agree || choice === agreeAlways) {
                sendCrashReportQueue()
            }
        } finally {
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

export function flush() {
    extensionClient.flush()
}
