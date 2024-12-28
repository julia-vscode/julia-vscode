module TestItemControllers

import AutoHashEquals, JSONRPC, Sockets, UUIDs, CoverageTools, URIParser

using AutoHashEquals: @auto_hash_equals

export JSONRPCTestItemController

include("json_protocol.jl")
include("../shared/testserver_protocol.jl")
include("../shared/urihelper.jl")

@auto_hash_equals struct TestEnvironment
    project_uri:: Union{Nothing,String}
    package_uri::String
    package_name::String
    juliaCmd::String
    juliaArgs::Vector{String}
    juliaNumThreads::String
    mode::String
    env::Dict{String,String}
end

function started_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.StartedParams, test_process)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:started, testitemid=params.testItemId, testrunid=params.testRunId)))
end

function passed_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.PassedParams, test_process)
    idx = findfirst(i->i.id == params.testItemId, test_process.testitems_to_run)
    if idx !== nothing
        deleteat!(test_process.testitems_to_run, idx)

        put!(test_process.parent_channel, (source=:testprocess, msg=(event=:passed, testitemid=params.testItemId, testrunid=params.testRunId, duration=params.duration, coverage=params.coverage, n_test_items_to_run = length(test_process.testitems_to_run), test_process_id = test_process.id)))
    else
        idx = findfirst(i->i.id == params.testItemId, test_process.stolen_testitems)
        if idx !== nothing
            deleteat!(test_process.stolen_testitems, idx)
        else
            error("Unknown test item notified")
        end
    end
end

function failed_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.FailedParams, test_process)
    idx = findfirst(i->i.id == params.testItemId, test_process.testitems_to_run)
    if idx !== nothing
        deleteat!(test_process.testitems_to_run, idx)

        put!(test_process.parent_channel, (source=:testprocess, msg=(event=:failed, testitemid=params.testItemId, testrunid=params.testRunId, messages=params.messages, n_test_items_to_run = length(test_process.testitems_to_run), test_process_id = test_process.id)))
    else
        idx = findfirst(i->i.id == params.testItemId, test_process.stolen_testitems)
        if idx !== nothing
            deleteat!(test_process.stolen_testitems, idx)
        else
            error("Unknown test item notified")
        end
    end

end

function errored_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.ErroredParams, test_process)
    idx = findfirst(i->i.id == params.testItemId, test_process.testitems_to_run)
    if idx !== nothing
        deleteat!(test_process.testitems_to_run, idx)

        put!(test_process.parent_channel, (source=:testprocess, msg=(event=:errored, testitemid=params.testItemId, testrunid=params.testRunId, messages=params.messages, n_test_items_to_run = length(test_process.testitems_to_run), test_process_id = test_process.id)))
    else
        idx = findfirst(i->i.id == params.testItemId, test_process.stolen_testitems)
        if idx !== nothing
            deleteat!(test_process.stolen_testitems, idx)
        else
            error("Unknown test item notified")
        end
    end
end

function skipped_stolen_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.SkippedStolenParams, test_process)
    idx = findfirst(i->i.id == params.testItemId, test_process.stolen_testitems)
    if idx !== nothing
        deleteat!(test_process.stolen_testitems, idx)
    else
        error("Unknown test item notified")
    end
end

function append_output_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.AppendOutputParams, test_process)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:append_output, testitemid=params.testItemId, testrunid=params.testRunId, output=params.output)))
end

function finished_batch_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::String, test_process)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:finished_batch, testrunid=params, test_process_id = test_process.id)))
end

JSONRPC.@message_dispatcher dispatch_testprocess_msg begin
    TestItemServerProtocol.started_notification_type => started_notification_handler
    TestItemServerProtocol.passed_notification_type => passed_notification_handler
    TestItemServerProtocol.failed_notification_type => failed_notification_handler
    TestItemServerProtocol.errored_notification_type => errored_notification_handler
    TestItemServerProtocol.skipped_stolen_notification_type => skipped_stolen_notification_handler
    TestItemServerProtocol.append_output_notification_type => append_output_notification_handler
    TestItemServerProtocol.finished_batch_notification_type => finished_batch_notification_handler
end

mutable struct TestProcess
    id::String

    parent_channel::Channel

    test_run_id::Union{Nothing,String}

    channel_to_sub::Channel

    env::TestEnvironment

    comms_established::Channel{Bool}

    activated::Channel{Bool}

    testitems_to_run::Vector{TestItemControllerProtocol.TestItem}
    stolen_testitems::Vector{TestItemControllerProtocol.TestItem}

    test_setups::Vector{TestItemServerProtocol.TestsetupDetails}

    jl_process::Union{Nothing,Base.Process}

    coverage_root_uris::Union{Vector{String},Nothing}

    debug_pipe_name::String

    killed::Bool

    endpoint::Union{Nothing,JSONRPC.JSONRPCEndpoint}

    test_env_content_hash::Union{Nothing,Int}

    function TestProcess(parent_channel::Channel, env::TestEnvironment, test_env_content_hash::Union{Nothing,Int})
        id = string(UUIDs.uuid4())
        return new(
            id,
            parent_channel,
            nothing,
            Channel(Inf),
            env,
            Channel{Bool}(1),
            Channel{Bool}(1),
            TestItemControllerProtocol.TestItem[],
            TestItemControllerProtocol.TestItem[],
            TestItemServerProtocol.TestsetupDetails[],
            nothing,
            nothing,
            JSONRPC.generate_pipe_name(),
            false,
            nothing,
            test_env_content_hash
        )
    end
end

mutable struct TestRun
    id::String
    running::Bool
    testitem_ids::Set{String}
    test_processes::Dict{TestEnvironment,Vector{TestProcess}}
end

function revise(tp::TestProcess, test_env_content_hash::Union{Int,Nothing})
    take!(tp.activated)

    put!(tp.channel_to_sub, (source=:controller, msg=(;command=:revise, test_env_content_hash=test_env_content_hash)))
end

function start(tp::TestProcess)
    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Launching")))

    pipe_name = JSONRPC.generate_pipe_name()
    server = Sockets.listen(pipe_name)

    testserver_script = joinpath(@__DIR__, "../packages/TestItemServer/app/testserver_main.jl")

    pipe_out = IOBuffer()
    pipe_err = IOBuffer()

    coverage_arg = tp.env.mode == "Coverage" ? "--code-coverage=user" : "--code-coverage=none"

# //             if(package_uri && false) {
# //                 jlArgs.push(`--code-coverage=@${vscode.Uri.parse(package_uri).fsPath}`)
# //             }
# //             else {

    jlArgs = copy(tp.env.juliaArgs)

    if tp.env.juliaNumThreads == "auto"
        push!(jlArgs, "--threads=auto")
    end

    jlEnv = copy(ENV)

    for (k,v) in pairs(tp.env.env)
        if v!==nothing
            jlEnv[k] = v
        elseif haskey(jlEnv, k)
            delete!(jlEnv, k)
        end
    end

    if tp.env.juliaNumThreads!="auto" && tp.env.juliaNumThreads!=""
        jlEnv["JULIA_NUM_THREADS"] = tp.env.juliaNumThreads
    end

    tp.jl_process = open(
        pipeline(
            Cmd(`$(tp.env.juliaCmd) $(tp.env.juliaArgs) --startup-file=no --history-file=no --depwarn=no $coverage_arg $testserver_script $pipe_name $(tp.debug_pipe_name)`, detach=false, env=jlEnv),
            stdout = pipe_out,
            stderr = pipe_err
        )
    )

    @async try
        while true
            s = String(take!(pipe_out))
            print(s)

            s = String(take!(pipe_err))
            print(s)

            sleep(0.5)
        end
    catch err
        Base.display_error(err, catch_backtrace())
    end

    @async try
        socket = Sockets.accept(server)

        tp.endpoint = JSONRPC.JSONRPCEndpoint(socket, socket)

        run(tp.endpoint)

        put!(tp.comms_established, true)

        while true
            msg = JSONRPC.get_next_message(tp.endpoint)
            put!(tp.channel_to_sub, (source=:testprocess, msg=msg))
        end
    catch err
        if !tp.killed
            Base.display_error(err, catch_backtrace())
        end
    end

    @async try
        while true
            msg = take!(tp.channel_to_sub)

            if msg.source==:controller
                if msg.msg.command == :activate
                    JSONRPC.send(
                        tp.endpoint,
                        TestItemServerProtocol.testserver_start_test_run_request_type,
                        tp.test_run_id
                    )

                    JSONRPC.send(
                        tp.endpoint,
                        TestItemServerProtocol.testserver_activate_env_request_type,
                        TestItemServerProtocol.ActivateEnvParams(
                            testRunId = tp.test_run_id,
                            projectUri=something(tp.env.project_uri, missing),
                            packageUri=tp.env.package_uri,
                            packageName=tp.env.package_name
                        )
                    )

                    JSONRPC.send(
                        tp.endpoint,
                        TestItemServerProtocol.testserver_set_test_setups_request_type,
                        TestItemServerProtocol.SetTestSetupsRequestParams(
                            testRunId = tp.test_run_id,
                            testSetups = tp.test_setups
                        )
                    )

                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Idle")))

                    put!(tp.activated, true)
                elseif msg.msg.command == :revise
                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Revising")))

                    needs_restart = false

                    if msg.msg.test_env_content_hash != tp.test_env_content_hash
                        needs_restart = true
                    else
                        JSONRPC.send(
                            tp.endpoint,
                            TestItemServerProtocol.testserver_start_test_run_request_type,
                            tp.test_run_id
                        )

                        res = JSONRPC.send(tp.endpoint, TestItemServerProtocol.testserver_revise_request_type, nothing)

                        if res=="success"
                            needs_restart = false
                        elseif res == "failed"
                            needs_restart = true
                        else
                            error("")
                        end
                    end

                    if !needs_restart
                        JSONRPC.send(
                            tp.endpoint,
                            TestItemServerProtocol.testserver_set_test_setups_request_type,
                            TestItemServerProtocol.SetTestSetupsRequestParams(
                                testRunId = tp.test_run_id,
                                testSetups = tp.test_setups
                            )
                        )

                        put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Idle")))
                        put!(tp.activated, true)
                    else
                        @info "Revise could not handle changes or test env was changed, restarting process"
                        kill(tp.jl_process)
                        tp.comms_established = Channel{Bool}(1)
                        start(tp)
                        fetch(tp.comms_established)
                        activate_env(tp)
                        break
                    end
                elseif msg.msg.command == :cancel
                    tp.killed = true
                    @info "Now canceling $(tp.id)"
                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Canceling")))
                    @info "Canceling process $(tp.id)"
                    kill(tp.jl_process)

                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_terminated, id=tp.id)))
                    break
                elseif msg.msg.command == :terminate
                    tp.killed = true
                    @info "Now terminating $(tp.id)"
                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Terminating")))
                    kill(tp.jl_process)

                    if tp.test_run_id!==nothing
                        for ti in tp.testitems_to_run
                            put!(tp.parent_channel, (source=:testprocess, msg=(event=:failed, testitemid=ti.id, testrunid=tp.test_run_id, messages=[TestItemServerProtocol.TestMessage("Test process was terminated.", TestItemServerProtocol.Location(ti.uri, TestItemServerProtocol.Position(ti.line-1, ti.column-1)))])))
                        end
                    end

                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_terminated, id=tp.id)))
                    break
                elseif msg.msg.command == :run
                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Running")))

                    JSONRPC.send(
                        tp.endpoint,
                        TestItemServerProtocol.testserver_run_testitems_batch_request_type,
                        TestItemServerProtocol.RunTestItemsRequestParams(
                            testRunId = tp.test_run_id,
                            mode = tp.env.mode,
                            coverageRootUris = something(tp.coverage_root_uris, missing),
                            testItems = TestItemServerProtocol.RunTestItem[
                                TestItemServerProtocol.RunTestItem(
                                    id = i.id,
                                    uri = i.uri,
                                    name = i.label,
                                    packageName = i.packageName,
                                    packageUri = i.packageUri,
                                    useDefaultUsings = i.useDefaultUsings,
                                    testSetups = i.testSetups,
                                    line = i.line,
                                    column = i.column,
                                    code = i.code,
                                ) for i in tp.testitems_to_run
                            ],
                        )
                    )
                else
                    error("")
                end
            elseif msg.source==:testprocess
                dispatch_testprocess_msg(tp.endpoint, msg.msg, tp)
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

function run_testitems(test_process::TestProcess, testitems::AbstractVector{TestItemControllerProtocol.TestItem}, testrunid::String, testsetups)
    empty!(test_process.testitems_to_run)
    append!(test_process.testitems_to_run, testitems)
    @async begin
        fetch(test_process.activated)

        put!(test_process.channel_to_sub, (source=:controller, msg=(;command=:run, testsetups = testsetups)))
    end
end

mutable struct JSONRPCTestItemController{ERR_HANDLER<:Function}
    err_handler::Union{Nothing,ERR_HANDLER}
    endpoint::JSONRPC.JSONRPCEndpoint

    combined_msg_queue::Channel

    testruns::Dict{String,TestRun}

    testprocesses::Dict{TestEnvironment,Vector{TestProcess}}

    precompiled_envs::Set{TestEnvironment}

    coverage::Dict{String,Vector{CoverageTools.FileCoverage}}

    function JSONRPCTestItemController(pipe_in, pipe_out, err_handler::ERR_HANDLER) where {ERR_HANDLER<:Union{Function,Nothing}}
        endpoint = JSONRPC.JSONRPCEndpoint(pipe_in, pipe_out, err_handler)
        return new{ERR_HANDLER}(
            err_handler,
            endpoint,
            Channel(Inf),
            Dict{String,TestRun}(),
            Dict{TestEnvironment,Vector{TestProcess}}(),
            Set{TestEnvironment}(),
            Dict{String,Vector{CoverageTools.FileCoverage}}()
        )
    end
end

@views function makechunks(X::AbstractVector, n::Integer)
    c = length(X) ÷ n
    return [X[1+c*k:(k == n-1 ? end : c*k+c)] for k = 0:n-1]
end

function create_testrun_request(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemControllerProtocol.CreateTestRunParams, controller::JSONRPCTestItemController)
    @info "Creating new test run"
    our_procs = Dict{TestEnvironment,Vector{TestProcess}}()

    test_run = TestRun(params.testRunId, true, Set(i.id for i in params.testItems), our_procs)

    max_procs = params.maxProcessCount

    controller.testruns[params.testRunId] = test_run

    testitems_by_env = Dict{TestEnvironment,Vector{TestItemControllerProtocol.TestItem}}()

    env_content_hash_by_env = Dict{TestEnvironment,Int}()

    for i in params.testItems
        te = TestEnvironment(
            coalesce(i.projectUri, nothing),
            i.packageUri,
            i.packageName,
            i.juliaCmd,
            i.juliaArgs,
            i.juliaNumThreads,
            i.mode,
            i.juliaEnv
        )

        testitems = get!(testitems_by_env, te) do
            TestItemControllerProtocol.TestItem[]
        end

        push!(testitems, i)

        if haskey(env_content_hash_by_env, te)
            if env_content_hash_by_env[te] != i.envContentHash
                error("This is invalid.")
            end
        else
            env_content_hash_by_env[te] = i.envContentHash
        end
    end

    proc_count_by_env = Dict{TestEnvironment,Int}()

    for (k,v) in pairs(testitems_by_env)
        as_share = length(v)/length(params.testItems)

        proc_count_by_env[k] = min(floor(Int, max_procs * as_share), length(params.testItems))
    end

    # Grab existing procs
    for (k,v) in pairs(proc_count_by_env)
        testprocesses = get!(controller.testprocesses, k) do
            TestProcess[]
        end

        existing_idle_procs = filter(i->i.test_run_id===nothing, testprocesses)

        @info "We need $(proc_count_by_env[k]) procs, there are $(length(testprocesses)) processes, of which $(length(existing_idle_procs)) are idle."

        our_procs[k] = TestProcess[]

        for p in Iterators.take(existing_idle_procs, v)
            p.test_run_id = params.testRunId
            p.test_setups = params.testSetups
            push!(our_procs[k], p)

            revise(p, env_content_hash_by_env[k])
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
            p = TestProcess(controller.combined_msg_queue, k, env_content_hash_by_env[k])
            p.coverage_root_uris = coalesce(params.coverageRootUris, nothing)
            JSONRPC.send(
                endpoint,
                TestItemControllerProtocol.notificationTypeTestProcessCreated,
                TestItemControllerProtocol.TestProcessCreatedParams(
                    id = p.id,
                    packageName = k.package_name,
                    packageUri = something(k.package_uri, missing),
                    projectUri = something(k.project_uri, missing),
                    coverage = k.mode == "Coverage",
                    env = k.env
                )
            )
            start(p)
            p.test_run_id = params.testRunId
            p.test_setups = params.testSetups
            push!(procs, p)
            push!(controller.testprocesses[k], p)

            if !already_precompiled && !precompile_launched
                @async try
                    fetch(p.comms_established)
                    activate_env(p)

                    push!(controller.precompiled_envs, k)

                    put!(precompile_done, true)
                catch err
                    Base.display_error(err, catch_backtrace())
                end
            else
                @async try
                    fetch(p.comms_established)
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
        if k.mode == "Debug"
            @async try
                for i in our_procs[k]
                    fetch(i.activated)
                end
                JSONRPC.send(endpoint, TestItemControllerProtocol.notificationTypeLaunchDebuggers, (;debugPipeNames = map(i->i.debug_pipe_name, our_procs[k]), testRunId = params.testRunId))
            catch err
                Base.display_error(err, catch_backtrace())
            end
        end

        n_procs = length(our_procs[k])

        chunks =  makechunks(v, n_procs)

        for (i,p) in enumerate(our_procs[k])
            run_testitems(p, chunks[i], params.testRunId, params.testSetups)
        end
    end

    nothing
end

function cancel_testrun_request(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemControllerProtocol.CancelTestRunParams, controller::JSONRPCTestItemController)
    if controller.testruns[params.testRunId].running
        controller.testruns[params.testRunId].running = false
        for v in values(controller.testprocesses)
            for p in v
                if p.test_run_id == params.testRunId
                    put!(p.channel_to_sub, (source=:controller, msg=(;command=:cancel)))
                end
            end
        end
        JSONRPC.send_notification(endpoint, "testRunFinished", (;testRunId=params.testRunId))
    end
end

function terminate_test_process_request(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemControllerProtocol.TerminateTestProcessParams, controller::JSONRPCTestItemController)
    for v in values(controller.testprocesses)
        for p in v
            if p.id == params.testProcessId
                put!(p.channel_to_sub, (source=:controller, msg=(;command=:terminate)))
            end
        end
    end
end

JSONRPC.@message_dispatcher dispatch_msg begin
    TestItemControllerProtocol.create_testrun_request_type => create_testrun_request
    TestItemControllerProtocol.cancel_testrun_request_type => cancel_testrun_request
    TestItemControllerProtocol.terminate_test_process_request_type => terminate_test_process_request
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

                if msg.msg.coverage !== missing
                    file_coverage = get!(controller.coverage, msg.msg.testrunid) do
                        CoverageTools.FileCoverage[]
                    end
                    append!(file_coverage, map(i->CoverageTools.FileCoverage(uri2filepath(i.uri), "", i.coverage), msg.msg.coverage))
                end
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
                            expectedOutput = missing,
                            actualOutput = missing,
                            uri = i.location.uri,
                            line = i.location.position.line,
                            column = i.location.position.character
                        ) for i in msg.msg.messages
                    ],
                    duration=missing
                )
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notficiationTypeTestItemErrored, params)
            elseif msg.msg.event == :test_process_status_changed
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notificationTypeTestProcessStatusChanged, TestItemControllerProtocol.TestProcessStatusChangedParams(id=msg.msg.id, status=msg.msg.status))
            elseif msg.msg.event == :test_process_terminated
                for procs in values(controller.testprocesses)
                    ind = findfirst(i->i.id==msg.msg.id, procs)
                    if ind!==nothing
                        deleteat!(procs, ind)
                    end
                end
                JSONRPC.send(controller.endpoint, TestItemControllerProtocol.notificationTypeTestProcessTerminated, msg.msg.id)
            elseif msg.msg.event == :finished_batch
                # First we find the test process instance and test env
                test_run = controller.testruns[msg.msg.testrunid]
                test_process = nothing
                test_processes_in_same_env = nothing
                test_env = nothing
                for (k,v) in pairs(test_run.test_processes)
                    ix = findfirst(i->i.id == msg.msg.test_process_id, v)
                    if ix!==nothing
                        test_process = v[ix]
                        test_processes_in_same_env = v
                        test_env = k
                        break
                    end
                end

                if test_process === nothing
                    error("This should never happen")
                end

                test_process_to_steal_from = nothing
                # Now we look through all test processes with the same env that have more than 1 pending test item to run
                for candidate_test_process in test_processes_in_same_env
                    n_test_items_still_pending = length(candidate_test_process.testitems_to_run)
                    # We only steal from this one if there are more than 1 test item pending
                    # AND if we haven't identified another process yet that has more pending test items
                    if isready(candidate_test_process.activated) && n_test_items_still_pending > 1 && (test_process_to_steal_from===nothing || length(test_process_to_steal_from.testitems_to_run) < n_test_items_still_pending)
                        test_process_to_steal_from = candidate_test_process
                    end
                end

                if test_process_to_steal_from === nothing
                    # Nothing to steal, so we give the test process back to the pool
                    JSONRPC.send(
                        test_process.endpoint,
                        TestItemServerProtocol.testserver_end_test_run_requst_type,
                        test_process.test_run_id
                    )

                    test_process.test_run_id = nothing

                    # TODO This is a bit weird, we could probably optimize this, as we are here putting a message into our own read channel
                    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=test_process.id, status="Idle")))
                else
                    # we just steal half the items at the end of the queue

                    steal_range = (div(length(test_process_to_steal_from.testitems_to_run), 2, RoundUp) + 1):lastindex(test_process_to_steal_from.testitems_to_run)

                    stolen_test_items = test_process_to_steal_from.testitems_to_run[steal_range]

                    deleteat!(test_process_to_steal_from.testitems_to_run, steal_range)

                    append!(test_process_to_steal_from.stolen_testitems, stolen_test_items)

                    # @info "NOW STEAL $steal_range from $(test_process_to_steal_from.id) for $(test_process.id) and we have an endpoint $(test_process_to_steal_from.endpoint!==nothing)"
                    JSONRPC.send(
                        test_process_to_steal_from.endpoint,
                        TestItemServerProtocol.testserver_steal_testitems_request_type,
                        TestItemServerProtocol.StealTestItemsRequestParams(
                            testRunId = test_process_to_steal_from.test_run_id,
                            testItemIds = map(i->i.id, stolen_test_items)
                        )
                    )

                    run_testitems(test_process, stolen_test_items, msg.msg.testrunid, missing)
                end
            else
                error("Unknown message")
            end

            if msg.msg.event in (:passed, :failed, :errored, :skipped)

                if length(test_run.testitem_ids)==0
                    if controller.testruns[msg.msg.testrunid].running
                        controller.testruns[msg.msg.testrunid].running = false
                        coverage_results = missing
                        if haskey(controller.coverage, msg.msg.testrunid)
                            coverage_results = map(CoverageTools.merge_coverage_counts(controller.coverage[msg.msg.testrunid])) do i
                                TestItemControllerProtocol.FileCoverage(
                                    uri = filepath2uri(i.filename),
                                    coverage = i.coverage
                                )
                            end
                        end
                        JSONRPC.send_notification(controller.endpoint, "testRunFinished", TestItemControllerProtocol.TestRunFinishedParams(testRunId=msg.msg.testrunid, coverage=coverage_results))
                    end
                end
            end
        else
            error("Unknown source")
        end
    end
end

end # module TestItemControllers
