import { DebugProtocol } from '@vscode/debugprotocol'
import { NotificationType, RequestType, RequestType0 } from 'vscode-jsonrpc'

/** Arguments for 'disconnect' response. */
interface DisconnectResponseArguments {
}

/** Arguments for 'setBreakpoints' response. */
interface SetBreakpointsResponseArguments {
    /** Information about the breakpoints.
                The array elements are in the same order as the elements of the 'breakpoints' (or the deprecated 'lines') array in the arguments.
            */
    breakpoints: DebugProtocol.Breakpoint[]
}

/** Arguments for 'stackTrace' response. */
interface StackTraceResponseArguments {
    /** The frames of the stackframe. If the array has length zero, there are no stackframes available.
                This means that there is no location information available.
            */
    stackFrames: DebugProtocol.StackFrame[]
    /** The total number of frames available. */
    totalFrames?: number
}

/** Arguments for 'setExceptionBreakpoints' response. */
interface SetExceptionBreakpointsResponseArguments {
}

/** Arguments for 'setFunctionBreakpoints' response. */
interface SetFunctionBreakpointsResponseArguments {
    /** Information about the breakpoints. The array elements correspond to the elements of the 'breakpoints' array. */
    breakpoints: DebugProtocol.Breakpoint[]
}

/** Arguments for 'scopes' response. */
interface ScopesResponseArguments {
    /** The scopes of the stackframe. If the array has length zero, there are no scopes available. */
    scopes: DebugProtocol.Scope[]
}

/** Arguments for 'source' response. */
interface SourceResponseArguments {
    /** Content of the source reference. */
    content: string
    /** Optional content type (mime type) of the source. */
    mimeType?: string
}

/** Arguments for 'variables' response. */
interface VariablesResponseArguments {
    /** All (or a range) of variables for the given variable reference. */
    variables: DebugProtocol.Variable[]
}

/** Arguments for 'continue' response. */
interface ContinueResponseArguments {
    /** If true, the 'continue' request has ignored the specified thread and continued all threads instead.
        If this attribute is missing a value of 'true' is assumed for backward compatibility.
    */
    allThreadsContinued?: boolean
}

/** Arguments for 'next' response. */
interface NextResponseArguments {
}

/** Arguments for 'stepIn' response. */
interface StepInResponseArguments {
}

interface StepInTargetsResponseArguments {
    targets: DebugProtocol.StepInTarget[]
}

/** Arguments for 'stepOut' response. */
interface StepOutResponseArguments {
}

/** Arguments for 'evaluate' response. */
interface EvaluateResponseArguments {
    /** The result of the evaluate request. */
    result: string
    /** The optional type of the evaluate result.
        This attribute should only be returned by a debug adapter if the client has passed the value true for the 'supportsVariableType' capability of the 'initialize' request.
    */
    type?: string
    /** Properties of a evaluate result that can be used to determine how to render the result in the UI. */
    presentationHint?: DebugProtocol.VariablePresentationHint
    /** If variablesReference is > 0, the evaluate result is structured and its children can be retrieved by passing variablesReference to the VariablesRequest.
        The value should be less than or equal to 2147483647 (2^31 - 1).
    */
    variablesReference: number
    /** The number of named child variables.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
        The value should be less than or equal to 2147483647 (2^31 - 1).
    */
    namedVariables?: number
    /** The number of indexed child variables.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
        The value should be less than or equal to 2147483647 (2^31 - 1).
    */
    indexedVariables?: number
    /** Optional memory reference to a location appropriate for this result.
        For pointer type eval results, this is generally a reference to the memory address contained in the pointer.
        This attribute should be returned by a debug adapter if the client has passed the value true for the 'supportsMemoryReferences' capability of the 'initialize' request.
    */
    memoryReference?: string
}

/** Arguments for 'terminate' response. */
interface TerminateResponseArguments {
}

/** Arguments for 'exceptionInfo' response. */
interface ExceptionInfoResponseArguments {
    /** ID of the exception that was thrown. */
    exceptionId: string
    /** Descriptive text for the exception provided by the debug adapter. */
    description?: string
    /** Mode that caused the exception notification to be raised. */
    breakMode: DebugProtocol.ExceptionBreakMode
    /** Detailed information about the exception. */
    details?: DebugProtocol.ExceptionDetails
}

/** Arguments for 'restartFrame' response. */
interface RestartFrameResponseArguments {
}

interface SetVariableResponseArguments {
    /** The new value of the variable. */
    value: string
    /** The type of the new value. Typically shown in the UI when hovering over the value. */
    type?: string
    /** If variablesReference is > 0, the new value is structured and its children can be retrieved by passing variablesReference to the VariablesRequest.
        The value should be less than or equal to 2147483647 (2^31 - 1).
    */
    variablesReference?: number
    /** The number of named child variables.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
        The value should be less than or equal to 2147483647 (2^31 - 1).
    */
    namedVariables?: number
    /** The number of indexed child variables.
        The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
        The value should be less than or equal to 2147483647 (2^31 - 1).
    */
    indexedVariables?: number
}

export interface StoppedArguments {
    /** The reason for the event.
        For backward compatibility this string is shown in the UI if the 'description' attribute is missing (but it must not be translated).
        Values: 'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto', 'function breakpoint', 'data breakpoint', 'instruction breakpoint', etc.
    */
    reason: string
    /** The full reason for the event, e.g. 'Paused on exception'. This string is shown in the UI as is and must be translated. */
    description?: string
    /** The thread which was stopped. */
    threadId?: number
    /** A value of true hints to the frontend that this event should not change the focus. */
    preserveFocusHint?: boolean
    /** Additional information. E.g. if reason is 'exception', text contains the exception name. This string is shown in the UI. */
    text?: string
    /** If 'allThreadsStopped' is true, a debug adapter can announce that all threads have stopped.
        - The client should use this information to enable that all threads can be expanded to access their stacktraces.
        - If the attribute is missing or false, only the thread with the given threadId can be expanded.
    */
    allThreadsStopped?: boolean
}

interface ThreadsResponseArguments {
    /** All threads. */
    threads: DebugProtocol.Thread[]
}

interface BreakpointLocationsResponseArguments {
    /** Sorted set of possible breakpoint locations. */
    breakpoints: DebugProtocol.BreakpointLocation[]
}

export const requestTypeDisconnect = new RequestType<DebugProtocol.DisconnectArguments, DisconnectResponseArguments, void>('disconnect')
export const requestTypeSetBreakpoints = new RequestType<DebugProtocol.SetBreakpointsArguments, SetBreakpointsResponseArguments, void>('setBreakpoints')
export const requestTypeSetExceptionBreakpoints = new RequestType<DebugProtocol.SetExceptionBreakpointsArguments, SetExceptionBreakpointsResponseArguments, void>('setExceptionBreakpoints')
export const requestTypeSetFunctionBreakpoints = new RequestType<DebugProtocol.SetFunctionBreakpointsArguments, SetFunctionBreakpointsResponseArguments, void>('setFunctionBreakpoints')
export const requestTypeStackTrace = new RequestType<DebugProtocol.StackTraceArguments, StackTraceResponseArguments, void>('stackTrace')
export const requestTypeScopes = new RequestType<DebugProtocol.ScopesArguments, ScopesResponseArguments, void>('scopes')
export const requestTypeSource = new RequestType<DebugProtocol.SourceArguments, SourceResponseArguments, void>('source')
export const requestTypeVariables = new RequestType<DebugProtocol.VariablesArguments, VariablesResponseArguments, void>('variables')
export const requestTypeContinue = new RequestType<DebugProtocol.ContinueArguments, ContinueResponseArguments, void>('continue')
export const requestTypeNext = new RequestType<DebugProtocol.NextArguments, NextResponseArguments, void>('next')
export const requestTypeStepIn = new RequestType<DebugProtocol.StepInArguments, StepInResponseArguments, void>('stepIn')
export const requestTypeStepInTargets = new RequestType<DebugProtocol.StepInTargetsArguments, StepInTargetsResponseArguments, void>('stepInTargets')
export const requestTypeStepOut = new RequestType<DebugProtocol.StepOutArguments, StepOutResponseArguments, void>('stepOut')
export const requestTypeEvaluate = new RequestType<DebugProtocol.EvaluateArguments, EvaluateResponseArguments, void>('evaluate')
export const requestTypeTerminate = new RequestType<DebugProtocol.TerminateArguments, TerminateResponseArguments, void>('terminate')
export const requestTypeExceptionInfo = new RequestType<DebugProtocol.ExceptionInfoArguments, ExceptionInfoResponseArguments, void>('exceptionInfo')
export const requestTypeRestartFrame = new RequestType<DebugProtocol.RestartFrameArguments, RestartFrameResponseArguments, void>('restartFrame')
export const requestTypeSetVariable = new RequestType<DebugProtocol.SetVariableArguments, SetVariableResponseArguments, void>('setVariable')
export const requestTypeThreads = new RequestType0<ThreadsResponseArguments, void>('threads')
export const requestTypeBreakpointLocations = new RequestType<DebugProtocol.BreakpointLocationsArguments, BreakpointLocationsResponseArguments, void>('breakpointLocations')
export const notifyTypeRun = new NotificationType<{ program: string }>('run')
export const notifyTypeDebug = new NotificationType<{ stopOnEntry: boolean, program: string, compiledModulesOrFunctions?: string[], compiledMode?: Boolean }>('debug')
export const notifyTypeExec = new NotificationType<{ stopOnEntry: boolean, code: string, file: string, compiledModulesOrFunctions?: string[], compiledMode?: Boolean }>('exec')
export const notifyTypeOurFinished = new NotificationType<void>('finished')
export const notifyTypeStopped = new NotificationType<StoppedArguments>('stopped')
export const notifyTypeSetCompiledItems = new NotificationType<{ compiledModulesOrFunctions: string[] }>('setCompiledItems')
export const notifyTypeSetCompiledMode = new NotificationType<{ compiledMode: Boolean }>('setCompiledMode')
