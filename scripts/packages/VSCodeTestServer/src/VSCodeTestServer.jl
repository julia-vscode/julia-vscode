module VSCodeTestServer

include("../../URIParser/src/URIParser.jl")

include("../../JSON/src/JSON.jl")
# include("../../CodeTracking/src/CodeTracking.jl")

module JSONRPC
import ..JSON
import UUIDs

include("../../JSONRPC/src/packagedef.jl")
end

# module JuliaInterpreter
# using ..CodeTracking

# @static if VERSION >= v"1.6.0"
#     include("../../JuliaInterpreter/src/packagedef.jl")
# else
#     include("../../../packages-old/JuliaInterpreter/src/packagedef.jl")
# end
# end

# module DebugAdapter
# import ..JuliaInterpreter
# import ..JSON
# import ..JSONRPC
# import ..JSONRPC: @dict_readable, Outbound

# include("../../DebugAdapter/src/packagedef.jl")
# end

import .JSONRPC: @dict_readable

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

@dict_readable struct Position
    line::Int
    character::Int
end

struct Range
    start::Position
    stop::Position
end
function JSON.lower(a::Range)
    Dict("start" => a.start, "end" => a.stop)
end

@dict_readable struct Location
    uri::String
    range::Range
end

@dict_readable struct TestMessage
    message::String
    # expectedOutput?: string;
    # actualOutput?: string;
    location::Union{Nothing,Location}
end

JSONRPC.@dict_readable struct TestserverRunTestitemRequestParams <: JSONRPC.Outbound
    uri::String
    line::Int
    column::Int
    code::String
end

JSONRPC.@dict_readable struct TestserverRunTestitemRequestParamsReturn <: JSONRPC.Outbound
    status::String
    message::Union{Vector{TestMessage},Nothing}
end

const testserver_run_testitem_request_type = JSONRPC.RequestType("testserver/runtestitem", TestserverRunTestitemRequestParams, TestserverRunTestitemRequestParamsReturn)

# TODO Use our new Uri2 once it is ready
function uri2filepath(uri::AbstractString)
    parsed_uri = try
        URIParser.URI(uri)
    catch
        throw(LSUriConversionFailure("Cannot parse `$uri`."))
    end

    if parsed_uri.scheme !== "file"
        return nothing
    end

    path_unescaped = URIParser.unescape(parsed_uri.path)
    host_unescaped = URIParser.unescape(parsed_uri.host)

    value = ""

    if host_unescaped != "" && length(path_unescaped) > 1
        # unc path: file://shares/c$/far/boo
        value = "//$host_unescaped$path_unescaped"
    elseif length(path_unescaped) >= 3 &&
           path_unescaped[1] == '/' &&
           isascii(path_unescaped[2]) && isletter(path_unescaped[2]) &&
           path_unescaped[3] == ':'
        # windows drive letter: file:///c:/far/boo
        value = lowercase(path_unescaped[2]) * path_unescaped[3:end]
    else
        # other path
        value = path_unescaped
    end

    if Sys.iswindows()
        value = replace(value, '/' => '\\')
    end

    value = normpath(value)

    return value
end

# TODO Use our new Uri2 once it is ready
function filepath2uri(file::String)
    isabspath(file) || error("Relative path `$file` is not valid.")
    if Sys.iswindows()
        file = normpath(file)
        file = replace(file, "\\" => "/")
        file = URIParser.escape(file)
        file = replace(file, "%2F" => "/")
        if startswith(file, "//")
            # UNC path \\foo\bar\foobar
            return string("file://", file[3:end])
        else
            # windows drive letter path
            return string("file:///", file)
        end
    else
        file = normpath(file)
        file = URIParser.escape(file)
        file = replace(file, "%2F" => "/")
        return string("file://", file)
    end
end

function run_testitem_handler(conn, params::TestserverRunTestitemRequestParams)
    mod = Core.eval(Main, :(module Testmodule end))

    filepath = uri2filepath(params.uri)

    code = string('\n'^params.line, ' '^params.column, params.code)

    try

        Base.invokelatest(include_string, mod, code, filepath)

        return TestserverRunTestitemRequestParamsReturn("passed", nothing)
    catch err
        bt = catch_backtrace()
        st = stacktrace(bt)

        error_message = sprint(Base.display_error, err, bt)

        filepath = string(st[1].file)

        return TestserverRunTestitemRequestParamsReturn(
            "errored",
            [
                TestMessage(
                    error_message,
                    Location(
                        filepath2uri(filepath),
                        Range(Position(st[1].line-1, 0), Position(st[1].line-1, 0))
                    )
                )
            ]
        )
    end
end

function serve(conn; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    @debug "connected"
    run(conn_endpoint[])
    @debug "running"

    msg_dispatcher = JSONRPC.MsgDispatcher()

    msg_dispatcher[testserver_run_testitem_request_type] = run_testitem_handler

    while conn_endpoint[] isa JSONRPC.JSONRPCEndpoint && isopen(conn)
        msg = JSONRPC.get_next_message(conn_endpoint[])

        JSONRPC.dispatch_msg(conn_endpoint[], msg_dispatcher, msg)
    end
end

end
