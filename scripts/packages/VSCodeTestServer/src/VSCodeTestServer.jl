module VSCodeTestServer

include("pkg_imports.jl")

import .JSONRPC: @dict_readable
import Test

include("testserver_protocol.jl")
include("helper.jl")
include("vscode_testset.jl")

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

function run_revise_handler(conn, params::Nothing)
    try
        @info "NOW TRYING TO REVISE"
        Revise.revise(throw=true)
        @info "FINISHED WITH REVISE"
        return "success"
    catch err
        Base.display_error(err, catch_backtrace())
        @info "FAILED TO REVISE"
        return "failed"
    end
end

function flatten_failed_tests!(ts, out)
    append!(out, i for i in ts.results if !(i isa Test.Pass))

    for cts in ts.children
        flatten_failed_tests!(cts, out)
    end
end

function run_testitem_handler(conn, params::TestserverRunTestitemRequestParams)
    mod = Core.eval(Main, :(module Testmodule end))

    filepath = uri2filepath(params.uri)

    code_without_begin_end = params.code[6:end-3]
    code = string('\n'^params.line, ' '^params.column, code_without_begin_end)

    ts = Test.DefaultTestSet("")

    Test.push_testset(ts)

    try
        Base.invokelatest(include_string, mod, code, filepath)
    catch err
        Test.pop_testset()

        bt = catch_backtrace()
        st = stacktrace(bt)

        error_message = sprint(Base.display_error, err, bt)

        @info "THE FILE PROBLEM IS " string(st[1].file)

        filepath = string(st[1].file)

        return TestserverRunTestitemRequestParamsReturn(
            "errored",
            [
                TestMessage(
                    error_message,
                    Location(
                        isabspath(filepath) ? filepath2uri(filepath) : "",
                        Range(Position(max(0, st[1].line - 1), 0), Position(max(0, st[1].line - 1), 0))
                    )
                )
            ]
        )
    end

    ts = Test.pop_testset()

    try
        Test.finish(ts)

        return TestserverRunTestitemRequestParamsReturn("passed", nothing)
    catch err
        if err isa Test.TestSetException
            failed_tests = Test.filter_errors(ts)

            return TestserverRunTestitemRequestParamsReturn(
                "failed",
                [TestMessage(sprint(Base.show, i), Location(filepath2uri(string(i.source.file)), Range(Position(i.source.line - 1, 0), Position(i.source.line - 1, 0)))) for i in failed_tests]
            )
        else
            rethrow(err)
        end
    end
end

function serve(conn, test_project; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    if test_project!=""
        TestEnv.activate(test_project)
    end

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

end
