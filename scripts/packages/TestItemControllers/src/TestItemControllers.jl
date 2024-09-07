module TestItemControllers

import AutoHashEquals, JSONRPC, Sockets, UUIDs, CoverageTools, URIParser

using AutoHashEquals: @auto_hash_equals

export JSONRPCTestItemController

include("json_protocol.jl")
include("../shared/testserver_protocol.jl")
include("../shared/urihelper.jl")

mutable struct TestRun
    id::String
    running::Bool
    testitem_ids::Set{String}
end

@auto_hash_equals struct TestEnvironment
    project_uri:: Union{Nothing,String}
    package_uri::String
    package_name::String
    test_env_content_hash::Union{Nothing,Int}
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
    delete!(test_process.testitems_to_run, params.testItemId)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:passed, testitemid=params.testItemId, testrunid=params.testRunId, duration=params.duration, coverage=params.coverage)))
    if length(test_process.testitems_to_run) == 0
        test_process.test_run_id = nothing
        put!(test_process.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=test_process.id, status="Idle")))
    end
end

function failed_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.FailedParams, test_process)
    delete!(test_process.testitems_to_run, params.testItemId)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:failed, testitemid=params.testItemId, testrunid=params.testRunId, messages=params.messages)))
    if length(test_process.testitems_to_run) == 0
        test_process.test_run_id = nothing
        put!(test_process.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=test_process.id, status="Idle")))
    end
end

function errored_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.ErroredParams, test_process)
    delete!(test_process.testitems_to_run, params.testItemId)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:errored, testitemid=params.testItemId, testrunid=params.testRunId, messages=params.messages)))
    if length(test_process.testitems_to_run) == 0
        test_process.test_run_id = nothing
        put!(test_process.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=test_process.id, status="Idle")))
    end
end

function append_output_notification_handler(endpoint::JSONRPC.JSONRPCEndpoint, params::TestItemServerProtocol.AppendOutputParams, test_process)
    put!(test_process.parent_channel, (source=:testprocess, msg=(event=:append_output, testitemid=params.testItemId, testrunid=params.testRunId, output=params.output)))
end

JSONRPC.@message_dispatcher dispatch_testprocess_msg begin
    TestItemServerProtocol.started_notification_type => started_notification_handler
    TestItemServerProtocol.passed_notification_type => passed_notification_handler
    TestItemServerProtocol.failed_notification_type => failed_notification_handler
    TestItemServerProtocol.errored_notification_type => errored_notification_handler
    TestItemServerProtocol.append_output_notification_type => append_output_notification_handler
end

mutable struct TestProcess
    id::String

    parent_channel::Channel

    test_run_id::Union{Nothing,String}

    channel_to_sub::Channel

    env::TestEnvironment

    comms_established::Channel{Bool}

    activated::Channel{Bool}

    testitems_to_run::Dict{String,TestItemControllerProtocol.TestItem}

    jl_process::Union{Nothing,Base.Process}

    coverage_root_uris::Union{Vector{String},Nothing}

    debug_pipe_name::String

    killed::Bool

    endpoint::Union{Nothing,JSONRPC.JSONRPCEndpoint}

    function TestProcess(parent_channel::Channel, env::TestEnvironment)
        id = string(UUIDs.uuid4())
        return new(id, parent_channel, nothing, Channel(Inf), env, Channel{Bool}(1), Channel{Bool}(1), Dict{String,TestItemControllerProtocol.TestItem}(), nothing, nothing, JSONRPC.generate_pipe_name(), false, nothing)
    end
end

function revise(tp::TestProcess)
    take!(tp.activated)

    put!(tp.channel_to_sub, (source=:controller, msg=(;command=:revise)))
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



        while true
            msg = take!(tp.channel_to_sub)

            if msg.source==:controller
                if msg.msg.command == :activate
                    JSONRPC.send(tp.endpoint, TestItemServerProtocol.testserver_activate_env_request_type, TestItemServerProtocol.ActivateEnvParams(testRunId = tp.test_run_id, projectUri=something(tp.env.project_uri, missing), packageUri=tp.env.package_uri, packageName=tp.env.package_name))

                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Idle")))

                    put!(tp.activated, true)
                elseif msg.msg.command == :revise
                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Revising")))
                    res = JSONRPC.send(tp.endpoint, TestItemServerProtocol.testserver_revise_request_type, nothing)

                    if res=="success"
                        put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Idle")))
                        put!(tp.activated, true)
                    elseif res=="failed"
                        @info "Revise could not handle changes, restarting process"
                        kill(tp.jl_process)
                        tp.comms_established = Channel{Bool}(1)
                        start(tp)
                        fetch(tp.comms_established)
                        activate_env(tp)
                        break
                    else
                        error()
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
                        for ti in values(tp.testitems_to_run)
                            put!(tp.parent_channel, (source=:testprocess, msg=(event=:failed, testitemid=ti.id, testrunid=tp.test_run_id, messages=[TestItemServerProtocol.TestMessage("Test process was terminated.", TestItemServerProtocol.Location(ti.uri, TestItemServerProtocol.Position(ti.line-1, ti.column-1)))])))
                        end
                    end

                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_terminated, id=tp.id)))
                    break
                elseif msg.msg.command == :run
                    put!(tp.parent_channel, (source=:testprocess, msg=(event=:test_process_status_changed, id=tp.id, status="Running")))

                    JSONRPC.send(
                        tp.endpoint,
                        TestItemServerProtocol.run_testitems_request_type,
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
                                ) for i in values(tp.testitems_to_run)
                            ],
                            testSetups = TestItemServerProtocol.TestsetupDetails[
                                TestItemServerProtocol.TestsetupDetails(
                                    packageUri = i.packageUri,
                                    name = i.name,
                                    kind = i.kind,
                                    uri = i.uri,
                                    line = i.line,
                                    column = i.column,
                                    code = i.code
                                ) for i in msg.msg.testsetups
                            ]
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
    for i in testitems
        test_process.testitems_to_run[i.id] = i
    end
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
    test_run = TestRun(params.testRunId, true, Set(i.id for i in params.testItems))

    max_procs = params.maxProcessCount

    controller.testruns[params.testRunId] = test_run

    testitems_by_env = Dict{TestEnvironment,Vector{TestItemControllerProtocol.TestItem}}()

    for i in params.testItems
        te = TestEnvironment(
            coalesce(i.projectUri, nothing),
            i.packageUri,
            i.packageName,
            coalesce(i.envContentHash, nothing),
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

        existing_idle_procs = filter(i->i.test_run_id===nothing, testprocesses)

        @info "We need $(proc_count_by_env[k]) procs, there are $(length(testprocesses)) processes, of which $(length(existing_idle_procs)) are idle."

        our_procs[k] = TestProcess[]

        for p in Iterators.take(existing_idle_procs, v)
            p.test_run_id = params.testRunId
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
            else
                error("Unknown message")
            end

            if msg.msg.event in (:passed, :failed, :errored, :skipped) && length(test_run.testitem_ids)==0
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
        else
            error("Unknown source")
        end
    end
end

end # module TestItemControllers
