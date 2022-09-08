module VSCodeTestServer

include("pkg_imports.jl")

import .JSONRPC: @dict_readable
import Test, Pkg

include("testserver_protocol.jl")
include("helper.jl")
include("vscode_testset.jl")

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

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
                ]
            )
        end

        if params.packageName!=""
            try
                Core.eval(mod, :(using $(Symbol(params.packageName))))
            catch err
                bt = catch_backtrace()
                error_message = sprint(Base.display_error, err, bt)

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
                    ]
                )
            end
        end
    end

    filepath = uri2filepath(params.uri)

    code_without_begin_end = params.code[6:end-3]
    code = string('\n'^params.line, ' '^params.column, code_without_begin_end)

    ts = Test.DefaultTestSet("")

    Test.push_testset(ts)

    try
        withpath(filepath) do
            Base.invokelatest(include_string, mod, code, filepath)
        end
    catch err
        Test.pop_testset()

        bt = catch_backtrace()
        st = stacktrace(bt)

        error_message = sprint(Base.display_error, err, bt)

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

function serve(conn, project_path, package_path, package_name; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
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
