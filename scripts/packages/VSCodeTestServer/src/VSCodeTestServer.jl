module VSCodeTestServer

include("../../URIParser/src/URIParser.jl")
include("../../JSON/src/JSON.jl")
include("../../OrderedCollections/src/OrderedCollections.jl")
include("../../CodeTracking/src/CodeTracking.jl")

module JSONRPC
import ..JSON
import UUIDs
include("../../JSONRPC/src/packagedef.jl")
end

module JuliaInterpreter
using ..CodeTracking
include("../../JuliaInterpreter/src/packagedef.jl")
end

module LoweredCodeUtils
using ..JuliaInterpreter
using ..JuliaInterpreter: SSAValue, SlotNumber, Frame
using ..JuliaInterpreter: @lookup, moduleof, pc_expr, step_expr!, is_global_ref, is_quotenode_egal, whichtt,
    next_until!, finish_and_return!, get_return, nstatements, codelocation, linetable,
    is_return, lookup_return, is_GotoIfNot, is_ReturnNode

include("../../LoweredCodeUtils/src/packagedef.jl")
end

module Revise
using ..OrderedCollections
using ..LoweredCodeUtils
using ..CodeTracking
using ..JuliaInterpreter
using ..CodeTracking: PkgFiles, basedir, srcfiles, line_is_decl, basepath
using ..JuliaInterpreter: whichtt, is_doc_expr, step_expr!, finish_and_return!, get_return,
    @lookup, moduleof, scopeof, pc_expr, is_quotenode_egal,
    linetable, codelocs, LineTypes, is_GotoIfNot, isassign, isidentical
using ..LoweredCodeUtils: next_or_nothing!, trackedheads, callee_matches
include("../../Revise/src/packagedef.jl")
end

# module DebugAdapter
# import ..JuliaInterpreter
# import ..JSON
# import ..JSONRPC
# import ..JSONRPC: @dict_readable, Outbound

# include("../../DebugAdapter/src/packagedef.jl")
# end

import .JSONRPC: @dict_readable
import Test

struct VSCodeTestSet <: Test.AbstractTestSet
    description::AbstractString
    results::Vector
    children::Vector
    VSCodeTestSet(desc) = new(desc, [], [])
end

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

const testserver_revise_request_type = JSONRPC.RequestType("testserver/revise", Nothing, String)
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

    ts = VSCodeTestSet("WE NEED A DESCRIPTION")

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

    failed_tests = []

    flatten_failed_tests!(ts, failed_tests)

    if length(failed_tests) == 0
        return TestserverRunTestitemRequestParamsReturn("passed", nothing)
    else
        return TestserverRunTestitemRequestParamsReturn(
            "failed",
            [TestMessage(sprint(Base.show, i), Location(filepath2uri(string(i.source.file)), Range(Position(i.source.line - 1, 0), Position(i.source.line - 1, 0)))) for i in failed_tests]
        )
    end
end

function Test.record(ts::VSCodeTestSet, res)
    push!(ts.results, res)
end

function Test.record(ts::VSCodeTestSet, res::VSCodeTestSet)
    push!(ts.children, res)
end

function Test.finish(ts::VSCodeTestSet)
    if Test.get_testset_depth() != 0
        # Attach this test set to the parent test set
        parent_ts = Test.get_testset()
        Test.record(parent_ts, ts)
        return ts
    end
end

function serve(conn; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
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
