module TestItemControllers

import AutoHashEquals, JSONRPC, Sockets

using AutoHashEquals: @auto_hash_equals

export JSONRPCTestItemController

include("json_protocol.jl")
include("../shared/testserver_protocol.jl")

mutable struct TestRun
    id::String
    running::Bool
    testitem_ids::Set{String}
end

@auto_hash_equals struct TestEnvironment
    project_uri:: Union{Nothing,String}
    package_uri::String
    packageName::String
    testEnvContentHash::Union{Nothing,Int}
    coverage::Bool
    env::Dict{String,String}
end

function started_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.StartedParams, test_process)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:started, testitemid=params.testitem_id, testrunid=params.testrun_id)))
end

function passed_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.PassedParams, test_process)
    delete!(test_process.testitems_to_run, params.testitem_id)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:passed, testitemid=params.testitem_id, testrunid=params.testrun_id, duration=params.duration)))
    if length(test_process.testitems_to_run) == 0
        test_process.testrun_id = nothing
    end
end

function failed_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.FailedParams, test_process)
    delete!(test_process.testitems_to_run, params.testitem_id)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:failed, testitemid=params.testitem_id, testrunid=params.testrun_id, messages=params.messages)))
    if length(test_process.testitems_to_run) == 0
        test_process.testrun_id = nothing
    end
end

function errored_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.ErroredParams, test_process)
    delete!(test_process.testitems_to_run, params.testitem_id)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:errored, testitemid=params.testitem_id, testrunid=params.testrun_id, messages=params.messages)))
    if length(test_process.testitems_to_run) == 0
        test_process.testrun_id = nothing
    end
end

function append_output_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.AppendOutputParams, test_process)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:append_output, testitemid=params.testitem_id, testrunid=params.testrun_id, output=params.output)))
end

JSONRPC.@message_dispatcher dispatch_testprocess_msg begin
    TestItemServerProtocol.started_notification_type => started_notification_handler
    TestItemServerProtocol.passed_notification_type => passed_notification_handler
    TestItemServerProtocol.failed_notification_type => failed_notification_handler
    TestItemServerProtocol.errored_notification_type => errored_notification_handler
    TestItemServerProtocol.append_output_notification_type => append_output_notification_handler
end

mutable struct TestProcess
    parent_channel::Channel

    testrun_id::Union{Nothing,String}

    channel_to_sub::Channel

    env::TestEnvironment

    activated::Channel{Bool}

    testitems_to_run::Dict{String,TestItemControllerProtocol.TestItem}

    jl_process::Union{Nothing,Base.Process}

    function TestProcess(parent_channel::Channel, env::TestEnvironment)
        return new(parent_channel, nothing, Channel(Inf), env, Channel{Bool}(1), Dict{String,TestItemControllerProtocol.TestItem}(), nothing)
    end
end

function revise(tp::TestProcess)
    take!(tp.activated)

    put!(tp.channel_to_sub, (source=:controller, msg=(;command=:revise)))
end

function start(tp::TestProcess)
    pipe_name = JSONRPC.generate_pipe_name()
    server = Sockets.listen(pipe_name)

    testserver_script = joinpath(@__DIR__, "../packages/TestItemServer/app/testserver_main.jl")

    pipe_out = IOBuffer()
    pipe_err = IOBuffer()

    tp.jl_process = open(
        pipeline(
            Cmd(`julia --startup-file=no --history-file=no --depwarn=no $testserver_script $pipe_name asdf`, detach=false),
            stdout = pipe_out,
            stderr = pipe_err
        )
    )

    @async try
        while true
            s = String(take!(pipe_out))
            # print(s)

            s = String(take!(pipe_err))
            # print(s)

            sleep(0.5)
        end
    catch err
        Base.display_error(err, catch_backtrace())
    end

    @async try
        socket = Sockets.accept(server)

        endpoint = JSONRPC.JSONRPCEndpoint(socket, socket)

        @async try
            while true
                msg = JSONRPC.get_next_message(endpoint)
                put!(tp.channel_to_sub, (source=:testprocess, msg=msg))
            end
        catch err
            Base.display_error(err, catch_backtrace())
        end

        run(endpoint)

        while true
            msg = take!(tp.channel_to_sub)

            if msg.source==:controller
                if msg.msg.command == :activate
                    JSONRPC.send(endpoint, TestItemServerProtocol.testserver_activate_env_request_type, TestItemServerProtocol.ActivateEnvParams(testrunId = tp.testrun_id, project_path=tp.env.project_uri, package_path=tp.env.package_uri, package_name=tp.env.packageName))

                    put!(tp.activated, true)
                elseif msg.msg.command == :revise
                    res = JSONRPC.send(endpoint, TestItemServerProtocol.testserver_revise_request_type, nothing)

                    if res=="success"
                        put!(tp.activated, true)
                    elseif res=="failed"
                        @info "Revise could not handle changes, restarting process"
                        kill(tp.jl_process)
                        start(tp)
                        activate_env(tp)
                        break
                    else
                        error()
                    end
                elseif msg.msg.command == :run
                    JSONRPC.send(
                        endpoint,
                        TestItemServerProtocol.run_testitems_request_type,
                        TestItemServerProtocol.RunTestitemRequestParams(
                            testrunId = tp.testrun_id,
                            testitems = TestItemServerProtocol.RunTestItem[
                                TestItemServerProtocol.RunTestItem(
                                    id = i.id,
                                    uri = i.uri,
                                    name = i.label,
                                    packageName = i.package_name,
                                    useDefaultUsings = i.useDefaultUsings,
                                    testsetups = i.testsetups,
                                    line = i.line,
                                    column = i.column,
                                    code = i.code,
                                    mode = i.mode,
                                    coverageRoots = missing
                                ) for i in values(tp.testitems_to_run)
                            ],
                            testsetups = TestItemServerProtocol.TestsetupDetails[]
                        )
                    )
                else
                    error("")
                end
            elseif msg.source==:testprocess
                dispatch_testprocess_msg(endpoint, msg.msg, tp)
            else
                error("")
            end
        end
    catch err
        Base.display_error(err, catch_backtrace())
    end
end

function activate_env(tp::TestProcess)
    put!(tp.channel_to_sub, (source=:controller, msg=(;command=:activate)))
end

function run_testitems(test_process::TestProcess, testitems::AbstractVector{TestItemControllerProtocol.TestItem}, testrunid::String)
    empty!(test_process.testitems_to_run)
    for i in testitems
        test_process.testitems_to_run[i.id] = i
    end
    @async begin
        fetch(test_process.activated)

        put!(test_process.channel_to_sub, (source=:controller, msg=(;command=:run)))
    end
end

mutable struct JSONRPCTestItemController{ERR_HANDLER<:Function}
    err_handler::Union{Nothing,ERR_HANDLER}
    endpoint::JSONRPC.JSONRPCEndpoint

    combined_msg_queue::Channel

    testruns::Dict{String,TestRun}

    testprocesses::Dict{TestEnvironment,Vector{TestProcess}}

    precompiled_envs::Set{TestEnvironment}

    function JSONRPCTestItemController(pipe_in, pipe_out, err_handler::ERR_HANDLER) where {ERR_HANDLER<:Union{Function,Nothing}}
        endpoint = JSONRPC.JSONRPCEndpoint(pipe_in, pipe_out, err_handler)
        return new{ERR_HANDLER}(
            err_handler,
            endpoint,
            Channel(Inf),
            Dict{String,TestRun}(),
            Dict{TestEnvironment,Vector{TestProcess}}(),
            Set{TestEnvironment}()
        )
    end
end

@views function makechunks(X::AbstractVector, n::Integer)
    c = length(X) ÷ n
    return [X[1+c*k:(k == n-1 ? end : c*k+c)] for k = 0:n-1]
end

function create_testrun_request(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemControllerProtocol.CreateTestRunParams, controller::JSONRPCTestItemController)
    @info "Creating new test run"
    test_run = TestRun(params.testRunId, true, Set(i.id for i in params.testItems))

    max_procs = 10

    controller.testruns[params.testRunId] = test_run

    testitems_by_env = Dict{TestEnvironment,Vector{TestItemControllerProtocol.TestItem}}()

    for i in params.testItems
        te = TestEnvironment(
            i.project_uri,
            i.package_uri,
            i.package_name,
            i.env_content_hash,
            params.kind == "Coverage",
            Dict{String,String}()
        )

        testitems = get!(testitems_by_env, te) do
            TestItemControllerProtocol.TestItem[]
        end

        push!(testitems, i)
    end

    proc_count_by_env = Dict{TestEnvironment,Int}()

    for (k,v) in pairs(testitems_by_env)
        as_share = length(v)/length(params.testItems)

        proc_count_by_env[k] = min(floor(Int, max_procs * as_share), length(params.testItems))
    end

    our_procs = Dict{TestEnvironment,Vector{TestProcess}}()

    # Grab existing procs
    for (k,v) in pairs(proc_count_by_env)
        testprocesses = get!(controller.testprocesses, k) do
            TestProcess[]
        end

        existing_idle_procs = filter(i->i.testrun_id===nothing, testprocesses)

        @info "We need $(proc_count_by_env[k]) procs, there are $(length(testprocesses)) processes, of which $(length(existing_idle_procs)) are idle."

        our_procs[k] = TestProcess[]

        for p in Iterators.take(existing_idle_procs, v)
            p.testrun_id = params.testRunId
            push!(our_procs[k], p)

            revise(p)
        end
    end

    # Launch new procs
    for (k,v) in pairs(proc_count_by_env)
        already_precompiled = k in controller.precompiled_envs
        procs = our_procs[k]

        precompile_done = Channel{Bool}(1)
        if already_precompiled
            put!(precompile_done, true)
        end

        precompile_launched = false

        while length(procs) < v
            @info "Launching new test process"
            p = TestProcess(controller.combined_msg_queue, k)
            start(p)
            p.testrun_id = params.testRunId
            push!(procs, p)
            push!(controller.testprocesses[k], p)

            if !already_precompiled && !precompile_launched
                @async try
                    activate_env(p)

                    push!(controller.precompiled_envs, k)

                    put!(precompile_done, true)
                catch err
                    Base.display_error(err, catch_backtrace())
                end
            else
                @async try
                    fetch(precompile_done)

                    activate_env(p)
                catch err
                    Base.display_error(err, catch_backtrace())
                end
            end
        end
    end

    # Now distribute test items over test processes
    for (k,v) in pairs(testitems_by_env)
        n_procs = length(our_procs[k])

        chunks =  makechunks(v, n_procs)

        for (i,p) in enumerate(our_procs[k])
            run_testitems(p, chunks[i], params.testRunId)
        end
    end

    nothing
end

function cancel_testrun_request(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemControllerProtocol.CancelTestRunParams, controller::JSONRPCTestItemController)
    if controller.testruns[params.testRunId].running
        controller.testruns[params.testRunId].running = false
        JSONRPC.send_notification(endpoint, "testRunFinished", (;testRunId=params.testRunId))
    end
end

JSONRPC.@message_dispatcher dispatch_msg begin
    TestItemControllerProtocol.create_testrun_request_type => create_testrun_request
    TestItemControllerProtocol.cancel_testrun_request_type => cancel_testrun_request
end

function Base.run(controller::JSONRPCTestItemController)
    run(controller.endpoint)

    @async try
        while true
            msg = JSONRPC.get_next_message(controller.endpoint)
            put!(controller.combined_msg_queue, (source=:client, msg=msg))
        end
    catch err
        bt = catch_backtrace()
        if controller.err_handler !== nothing
            controller.err_handler(err, bt)
        else
            Base.display_error(err, bt)
        end
    end

    while true
        msg = take!(controller.combined_msg_queue)

        if msg.source==:client
            dispatch_msg(controller.endpoint, msg.msg, controller)
        elseif msg.source==:testprocess
            if msg.msg.event == :started
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notficiationTypeTestItemStarted, TestItemControllerProtocol.TestItemStartedParams(testRunId=msg.msg.testrunid, testItemId=msg.msg.testitemid))
            elseif msg.msg.event == :append_output
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notficiationTypeAppendOutput, TestItemControllerProtocol.AppendOutputParams(testRunId=msg.msg.testrunid, testItemId=msg.msg.testitemid, output=msg.msg.output))
            elseif msg.msg.event == :passed
                test_run = controller.testruns[msg.msg.testrunid]

                delete!(test_run.testitem_ids, msg.msg.testitemid)
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notficiationTypeTestItemPassed, TestItemControllerProtocol.TestItemPassedParams(testRunId=msg.msg.testrunid, testItemId=msg.msg.testitemid, duration=msg.msg.duration))
            elseif msg.msg.event == :failed
                test_run = controller.testruns[msg.msg.testrunid]

                delete!(test_run.testitem_ids, msg.msg.testitemid)
                params = TestItemControllerProtocol.TestItemFailedParams(
                    testRunId=msg.msg.testrunid,
                    testItemId=msg.msg.testitemid,
                    messages = TestItemControllerProtocol.TestMessage[
                        TestItemControllerProtocol.TestMessage(
                            message = i.message,
                            expectedOutput = i.expectedOutput,
                            actualOutput = i.actualOutput,
                            uri = i.location.uri,
                            line = i.location.position.line,
                            column = i.location.position.character
                        ) for i in msg.msg.messages
                    ],
                    duration=missing
                )
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notficiationTypeTestItemFailed, params)
            elseif msg.msg.event == :errored
                test_run = controller.testruns[msg.msg.testrunid]

                delete!(test_run.testitem_ids, msg.msg.testitemid)
                params = TestItemControllerProtocol.TestItemErroredParams(
                    testRunId=msg.msg.testrunid,
                    testItemId=msg.msg.testitemid,
                    messages = TestItemControllerProtocol.TestMessage[
                        TestItemControllerProtocol.TestMessage(
                            message = i.message,
                            expectedOutput = nothing,
                            actualOutput = nothing,
                            uri = i.location.uri,
                            line = i.location.position.line,
                            column = i.location.position.character
                        ) for i in msg.msg.messages
                    ],
                    duration=missing
                )
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notficiationTypeTestItemErrored, params)
            end

            if msg.msg.event in (:passed, :failed, :errored, :skipped) && length(test_run.testitem_ids)==0
                if controller.testruns[msg.msg.testrunid].running
                    controller.testruns[msg.msg.testrunid].running = false
                    JSONRPC.send_notification(controller.endpoint, "testRunFinished", (;testRunId=msg.msg.testrunid))
                end
            end
        else
            error("Unknown source")
        end
    end
end

end # module TestItemControllers
