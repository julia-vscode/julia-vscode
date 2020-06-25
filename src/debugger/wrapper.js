const cp = require('child_process')

console.log('hi')



console.warn('huhuhuhu')

const test = cp.spawn('C:\\Users\\david\\AppData\\Local\\Programs\\Julia\\Julia-1.4.2\\bin\\julia.exe')

test.stdin.pipe(process.stdin)
test.stdout.pipe(process.stdout)
test.stderr.pipe(process.stderr)

console.log(test.status)

console.log('hi again')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function foo() {
    await sleep(10000)

    await new Promise((resolve) => { console.log(42); setTimeout(resolve, 10000) })
}

setInterval(function () {
    console.log('timer that keeps nodejs processing running')
}, 1000 * 60 * 60)

foo()

// keep the application alive forever to see what happens
function wait() {
    setTimeout(wait, 1000)
}
wait()

process.stdin.resume()

// try {
//     console.log('Are we in BUSINESS??')


//     // using Sockets
//     const path = require('path')
//     const cp = require('child_process')

//     const pipename_for_wrapper = process.argv[3]
//     const pipename_for_debugger = process.argv[2]
//     const cwd = process.argv[4]
//     const julia_env = process.argv[5]
//     const pipename_for_crashreporting = process.argv[6]

//     const jl_cmd = process.arg[7]

//     // conn = Sockets.connect(pipename_for_wrapper)

//     const debugger_script = path.join(__dirname, '..', '..', 'scripts', 'debugger', 'run_debugger.jl')

//     cmd = `${jl_cmd} --color=yes --history-file=no --startup-file=no --project=${julia_env} ${debugger_script} ${pipename_for_debugger} ${pipename_for_crashreporting}`

//     const p = cp.execSync(cmd, { cwd = cwd })

//     // p = run(pipeline(cmd, stdin = stdin, stdout = stdout, stderr = stderr), wait = false)

//     // @async begin
//     // l = readline(conn)

//     // if l == "TERMINATE"
//     //         kill(p)
//     // else
//     //     error("Invalid state.")
//     // end
//     // end


//     // wait(p)

//     console.log()
//     console.log('Julia debuggee finished. Press ENTER to close this terminal.\n') //, bold = true)

//     //readline()
// }
// catch (err) {
//     console.log('hi')
// }
