/**
 * Shared description of a Julia process the extension supervises being killed
 * from outside it.
 *
 * The language server and the test item controller are ours: we spawn them, we
 * keep them alive, and the memory they grow into is a consequence of how this
 * extension and the packages it bundles behave. So an out-of-memory kill of
 * either is not safely the machine's business — it can just as well be a leak
 * on our side, and that is only visible if the report carries enough to tell
 * the two apart.
 *
 * Their child processes are a different matter and deliberately not covered
 * here: the indexing children and the test processes run user code, and the
 * memory that gets them killed is the user's to account for. Those are shown
 * to the user without being reported.
 *
 * Running out of memory does not always take a kill from outside: when an
 * allocation inside LLVM fails, the Julia runtime ends itself instead. The
 * same reasoning applies, so that case is described here as well.
 */

/**
 * Bytes as a human-readable size. Kept here rather than in either caller so
 * that the two reports are formatted identically.
 */
export function formatBytes(bytes: number) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value = value / 1024
        unit += 1
    }
    return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`
}

/** What the machine's memory looked like when a process was killed. */
export interface MemorySnapshot {
    total: number
    free: number
    cgroupLimit: number | null
}

/**
 * The body of the report filed when a supervised process is killed from
 * outside. `extra` carries whatever the particular process can add — the live
 * test process count for the controller, the Julia executable and stderr tail
 * for the server.
 *
 * No paths or package names go in here, only numbers, the signal and whatever
 * the caller has already sanitized.
 */
export function osKillReport(
    processDescription: string,
    signal: NodeJS.Signals,
    memory: MemorySnapshot,
    extra: string[] = []
): string {
    return [`${processDescription} was killed with ${signal}`, memoryLine(memory), ...extra].join('\n')
}

function memoryLine(memory: MemorySnapshot): string {
    return `Memory: ${formatBytes(memory.free)} free of ${formatBytes(memory.total)}, cgroup limit ${
        memory.cgroupLimit === null ? 'none' : formatBytes(memory.cgroupLimit)
    }`
}

/**
 * The notification shown for the same event. Says what happened and names the
 * likely cause without asserting it, since the same signals also arrive from a
 * container stop or a session teardown.
 */
export function osKillNotification(processDescription: string, signal: NodeJS.Signals): string {
    return `${processDescription} was stopped by the operating system (${signal}), most likely because it ran out of memory.`
}

/**
 * The body of the report filed when a supervised process ended itself because
 * an allocation inside LLVM failed, see `isLlvmOutOfMemory` in
 * `languageClient.ts`. How the process then ends varies with the platform and
 * the Julia version, so the exit code and signal are carried along, but they
 * say nothing about the cause. Same rules as `osKillReport` for what goes in.
 */
export function outOfMemoryReport(
    processDescription: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    memory: MemorySnapshot,
    extra: string[] = []
): string {
    return [
        `${processDescription} ran out of memory (exit code ${code ?? 'none'}, signal ${signal ?? 'none'})`,
        memoryLine(memory),
        ...extra,
    ].join('\n')
}

/**
 * The notification shown for the same event. Unlike `osKillNotification` it
 * need not hedge on the cause: the process said itself that it was out of
 * memory.
 */
export function outOfMemoryNotification(processDescription: string): string {
    return `${processDescription} ran out of memory.`
}
