import * as assert from 'assert'
import * as net from 'net'
import { v4 as uuidv4 } from 'uuid'
import { getCrashReportingPipename, startLsCrashServer } from '../../telemetry'
import { generatePipeName } from '../../utils'

function closeServer(server: net.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()))
}

suite('startLsCrashServer', () => {
    test('hands a failed listen to its error handler instead of throwing', async () => {
        // A pipe that is already being listened on fails the second listen with
        // EADDRINUSE on every platform, which stands in for the full temp
        // directory (ENOSPC) seen in telemetry.
        const pipename = generatePipeName(uuidv4(), 'vsc-jl-cr-test')
        const occupant = net.createServer()
        await new Promise<void>((resolve) => occupant.listen(pipename, resolve))

        let crashServer: net.Server
        try {
            const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
                crashServer = startLsCrashServer(pipename, resolve)
            })

            assert.strictEqual(err.code, 'EADDRINUSE')
            assert.strictEqual(crashServer.listening, false)
            // The Julia processes are still given the name; they cope with a
            // pipe that nobody listens on.
            assert.strictEqual(getCrashReportingPipename(), pipename)
        } finally {
            await closeServer(occupant)
        }
    })

    test('listens on the pipe it hands to the Julia processes', async () => {
        const pipename = generatePipeName(uuidv4(), 'vsc-jl-cr-test')
        const crashServer = startLsCrashServer(pipename, (err) => assert.fail(err))
        try {
            await new Promise<void>((resolve) => crashServer.once('listening', resolve))

            assert.strictEqual(getCrashReportingPipename(), pipename)
        } finally {
            await closeServer(crashServer)
        }
    })
})
