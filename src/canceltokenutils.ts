import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc'

export function createTimeoutCancellation(millis: number): CancellationToken {
    const source = new CancellationTokenSource()
    setTimeout(() => source.cancel(), millis)
    return source.token
}

export function combineCancellationTokens(a: CancellationToken, b: CancellationToken): CancellationToken {
    if (a.isCancellationRequested || b.isCancellationRequested) {
        return CancellationToken.Cancelled
    }
    const source = new CancellationTokenSource()
    a.onCancellationRequested(() => source.cancel())
    b.onCancellationRequested(() => source.cancel())
    return source.token
}
