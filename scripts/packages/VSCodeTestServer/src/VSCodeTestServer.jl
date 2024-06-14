module VSCodeTestServer

include("pkg_imports.jl")

import .JSONRPC: @dict_readable
import Test, Pkg, Sockets

include("testserver_protocol.jl")
include("helper.jl")
include("vscode_testset.jl")

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)
const DEBUG_SESSION = Ref{Channel{DebugAdapter.DebugSession}}()

function __init__()
    DEBUG_SESSION[] = Channel{DebugAdapter.DebugSession}(1)
end

function withpath(f, path)
    tls = task_local_storage()
    hassource = haskey(tls, :SOURCE_PATH)
    hassource && (path′ = tls[:SOURCE_PATH])
    tls[:SOURCE_PATH] = path
    try
        return f()
    finally
        hassource ? (tls[:SOURCE_PATH] = path′) : delete!(tls, :SOURCE_PATH)
    end
end


function run_revise_handler(conn, params::Nothing)
    try
        Revise.revise(throw=true)
        return "success"
    catch err
        Base.display_error(err, catch_backtrace())
        return "failed"
    end
end

function flatten_failed_tests!(ts, out)
    append!(out, i for i in ts.results if !(i isa Test.Pass))

    for cts in ts.children
        flatten_failed_tests!(cts, out)
    end
end

function format_error_message(err, bt)
    try
        return Base.invokelatest(sprint, Base.display_error, err, bt)
    catch err
        # TODO We could probably try to output an even better error message here that
        # takes into account `err`. And in the callsites we should probably also
        # handle this better.
        return "Error while trying to format an error message"
    end
end

function run_testitem_handler(conn, params::TestserverRunTestitemRequestParams)
    mod = Core.eval(Main, :(module $(gensym()) end))

    if params.useDefaultUsings
        try
            Core.eval(mod, :(using Test))
        catch
            return TestserverRunTestitemRequestParamsReturn(
                "errored",
                [
                    TestMessage(
                        "Unable to load the `Test` package. Please ensure that `Test` is listed as a test dependency in the Project.toml for the package.",
                        Location(
                            params.uri,
                            Range(Position(params.line, 0), Position(params.line, 0))
                        )
                    )
                ],
                nothing
            )
        end

        if params.packageName!=""
            try
                Core.eval(mod, :(using $(Symbol(params.packageName))))
            catch err
                bt = catch_backtrace()
                error_message = format_error_message(err, bt)

                return TestserverRunTestitemRequestParamsReturn(
                    "errored",
                    [
                        TestMessage(
                            error_message,
                            Location(
                                params.uri,
                                Range(Position(params.line, 0), Position(params.line, 0))
                            )
                        )
                    ],
                    nothing
                )
            end
        end
    end

    filepath = uri2filepath(params.uri)

    code = string('\n'^params.line, ' '^params.column, params.code)

    ts = Test.DefaultTestSet("$filepath:$(params.name)")

    Test.push_testset(ts)

    elapsed_time = UInt64(0)

    t0 = time_ns()
    try
        withpath(filepath) do

            if params.debug
                debug_session = wait_for_debug_session()
                DebugAdapter.debug_code(debug_session, mod, code, filepath, false)
            else
                Base.invokelatest(include_string, mod, code, filepath)
            end
            elapsed_time = (time_ns() - t0) / 1e6 # Convert to milliseconds
        end
    catch err
        elapsed_time = (time_ns() - t0) / 1e6 # Convert to milliseconds

        Test.pop_testset()

        bt = catch_backtrace()
        st = stacktrace(bt)

        error_message = format_error_message(err, bt)

        if err isa LoadError
            error_filepath = err.file
            error_line = err.line
        else
            error_filepath =  string(st[1].file)
            error_line = st[1].line
        end

        return TestserverRunTestitemRequestParamsReturn(
            "errored",
            [
                TestMessage(
                    error_message,
                    Location(
                        isabspath(error_filepath) ? filepath2uri(error_filepath) : "",
                        Range(Position(max(0, error_line - 1), 0), Position(max(0, error_line - 1), 0))
                    )
                )
            ],
            elapsed_time
        )
    end

    ts = Test.pop_testset()

    try
        Test.finish(ts)

        return TestserverRunTestitemRequestParamsReturn("passed", nothing, elapsed_time)
    catch err
        if err isa Test.TestSetException
            failed_tests = Test.filter_errors(ts)

            return TestserverRunTestitemRequestParamsReturn(
                "failed",
                [ create_test_message_for_failed(i) for i in failed_tests],
                elapsed_time
            )
        else
            rethrow(err)
        end
    end
end

function create_test_message_for_failed(i)
    (expected, actual) = extract_expected_and_actual(i)
    return TestMessage(sprint(Base.show, i),
        expected,
        actual,
        Location(filepath2uri(string(i.source.file)), Range(Position(i.source.line - 1, 0), Position(i.source.line - 1, 0))))
end

function extract_expected_and_actual(result)
    if isa(result, Test.Fail)
        s = result.data
        if isa(s, String)
            m = match(r"\"(.*)\" == \"(.*)\"", s)
            if m !== nothing
                try
                    expected = unescape_string(m.captures[1])
                    actual = unescape_string(m.captures[2])
                    return (expected, actual)
                catch err
                    # theoretically possible if a user registers a Fail instance that matches
                    # above regexp, but doesn't contain two escaped strings.
                    # just return nothing in this unlikely case, meaning no diff will be shown.
                end
            end
        end
    end
    return (nothing, nothing)
end

function serve_in_env(conn)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    @debug "connected"
    run(conn_endpoint[])
    @debug "running"

    msg_dispatcher = JSONRPC.MsgDispatcher()

    msg_dispatcher[testserver_revise_request_type] = run_revise_handler
    msg_dispatcher[testserver_run_testitem_request_type] = run_testitem_handler

    while conn_endpoint[] isa JSONRPC.JSONRPCEndpoint && isopen(conn)
        msg = JSONRPC.get_next_message(conn_endpoint[])

        JSONRPC.dispatch_msg(conn_endpoint[], msg_dispatcher, msg)
    end
end

function start_debug_backend(debug_pipename)
    ready = Channel{Bool}(1)
    @async try
        server = Sockets.listen(debug_pipename)

        put!(ready, true)

        while true
            conn = Sockets.accept(server)

            debug_session = DebugAdapter.DebugSession(conn)

            global DEBUG_SESSION

            put!(DEBUG_SESSION[], debug_session)

            try
                run(debug_session)
            finally
                take!(DEBUG_SESSION[])
            end
        end
    catch err
        println("ERROR ", err)
        Base.display_error(catch_backtrace())
    end

    take!(ready)
end

function wait_for_debug_session()
    fetch(DEBUG_SESSION[])
end

function get_debug_session_if_present()
    if isready(DEBUG_SESSION[])
        return fetch(DEBUG_SESSION[])
    else
        return nothing
    end
end

function serve(pipename, debug_pipename, project_path, package_path, package_name; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    start_debug_backend(debug_pipename)

    conn = Sockets.connect(pipename)

    @info "This test server instance was started with the following configuration." project_path package_path package_name
    if project_path==""
        Pkg.activate(temp=true)

        Pkg.develop(path=package_path)

        TestEnv.activate(package_name) do
            serve_in_env(conn)
        end
    else
        Pkg.activate(project_path)

        if package_name!=""
            TestEnv.activate(package_name) do
                serve_in_env(conn)
            end
        else
            serve_in_env(conn)
        end
    end
end

end
