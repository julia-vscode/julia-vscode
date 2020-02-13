# Request handlers

function run_request(conn, state, msg_body, msg_id)
    @debug "run_request"

    state.debug_mode = :launch
    
    try
        include(msg_body)
    catch err
        Base.display_error(stderr, err, catch_backtrace())
    end

    send_notification(conn, "FINISHED")

    return :break
end

function debug_request(conn, state, msg_body, msg_id)
    @debug "debug_request"

    state.debug_mode = :launch
    index_of_sep = findfirst(';', msg_body)

    stop_on_entry_as_string = msg_body[1:index_of_sep-1]

    stop_on_entry = stop_on_entry_as_string=="stopOnEntry=true"

    filename_to_debug = msg_body[index_of_sep+1:end]

    @debug "We are debugging the file $filename_to_debug."

    ex = _parse_julia_file(filename_to_debug)

    state.top_level_expressions, _ = JuliaInterpreter.split_expressions(Main, ex)
    state.current_top_level_expression = 0

    state.frame = get_next_top_level_frame(state)

    if stop_on_entry
        send_notification(conn, "STOPPEDENTRY")
    elseif JuliaInterpreter.shouldbreak(state.frame, state.frame.pc)
        send_notification(conn, "STOPPEDBP")
    else
        ret = our_debug_command(:c, state)

        if ret===nothing
            send_notification(conn, "FINISHED")
            return :break
        else
            send_stopped_msg(conn, ret, state)                        
        end
    end

    return
end

function exec_request(conn, state, msg_body, msg_id)
    @debug "exec_request"

    state.debug_mode = :attach

    index_of_sep = findfirst(';', msg_body)

    stop_on_entry_as_string = msg_body[1:index_of_sep-1]

    stop_on_entry = stop_on_entry_as_string=="stopOnEntry=true"

    code_to_debug = msg_body[index_of_sep+1:end]

    state.sources[0] = code_to_debug

    ex = Meta.parse(code_to_debug)

    state.top_level_expressions, _ = JuliaInterpreter.split_expressions(Main, ex)
    state.current_top_level_expression = 0

    state.frame = get_next_top_level_frame(state)

    if stop_on_entry
        send_notification(conn, "STOPPEDENTRY")
    elseif JuliaInterpreter.shouldbreak(state.frame, state.frame.pc)
        send_notification(conn, "STOPPEDBP")
    else
        ret = our_debug_command(:c, state)

        if ret===nothing
            send_notification(conn, "FINISHED")
        else
            send_stopped_msg(conn, ret, state)
        end                
    end
end

function setbreakpoints_request(conn, state, msg_body, msg_id)
    @debug "setbreakpoints_request"

    splitted_line = split(msg_body, ';')

    file = splitted_line[1]
    bps = map(split(i, ':') for i in splitted_line[2:end]) do i
        decoded_condition = String(Base64.base64decode(i[2]))
        # We handle conditions that don't parse properly as
        # no condition for now
        parsed_condition = try
            decoded_condition=="" ? nothing : Meta.parse(decoded_condition)
        catch err
            nothing
        end

        (line=parse(Int,i[1]), condition=parsed_condition)
    end

    for bp in JuliaInterpreter.breakpoints()
        if bp isa JuliaInterpreter.BreakpointFileLocation
            if bp.path==file
                JuliaInterpreter.remove(bp)
            end
        end
    end

    for bp in bps
        @debug "Setting one breakpoint at line $(bp.line) with condition $(bp.condition) in file $file."

        JuliaInterpreter.breakpoint(string(file), bp.line, bp.condition)                        
    end
end

function setexceptionbreakpoints_request(conn, state, msg_body, msg_id)
    @debug "setexceptionbreakpoints_request"

    opts = Set(split(msg_body, ';'))

    if "error" in opts                    
        JuliaInterpreter.break_on(:error)
    else
        JuliaInterpreter.break_off(:error)
    end

    if "throw" in opts
        JuliaInterpreter.break_on(:throw )
    else
        JuliaInterpreter.break_off(:throw )
    end

    if "compilemode" in opts
        state.compile_mode = JuliaInterpreter.Compiled()
    else
        state.compile_mode = JuliaInterpreter.finish_and_return!
    end
end

function setfunctionbreakpoints_request(conn, state, msg_body, msg_id)
    @debug "setfunctionbreakpoints_request"

    funcs = split(msg_body, ';', keepempty=false)

    bps = map(split(i, ':') for i in funcs) do i
        decoded_name = String(Base64.base64decode(i[1]))
        decoded_condition = String(Base64.base64decode(i[2]))

        parsed_condition = try
            decoded_condition=="" ? nothing : Meta.parse(decoded_condition)
        catch err
            nothing
        end

        try
            parsed_name = Meta.parse(decoded_name)

            if parsed_name isa Symbol
                return (mod=Main, name=parsed_name, signature=nothing, condition=parsed_condition)
            elseif parsed_name isa Expr
                if parsed_name.head==:.
                    # TODO Support this case
                    return nothing
                elseif parsed_name.head==:call
                    all_args_are_legit = true
                    if length(parsed_name.args)>1
                        for arg in parsed_name.args[2:end]
                            if !(arg isa Expr) || arg.head!=Symbol("::") || length(arg.args)!=1
                                all_args_are_legit =false
                            end
                        end
                        if all_args_are_legit

                            return (mod=Main, name=parsed_name.args[1], signature=map(j->j.args[1], parsed_name.args[2:end]), condition=parsed_condition)
                        else
                            return (mod=Main, name=parsed_name.args[1], signature=nothing, condition=parsed_condition)
                        end
                    else
                        return (mod=Main, name=parsed_name.args[1], signature=nothing, condition=parsed_condition)
                    end
                else
                    return nothing
                end
            else
                return nothing
            end
        catch err
            return nothing
        end

        return nothing
    end

    bps = filter(i->i!==nothing, bps)

    for bp in JuliaInterpreter.breakpoints()
        if bp isa JuliaInterpreter.BreakpointSignature
            JuliaInterpreter.remove(bp)
        end
    end

    state.not_yet_set_function_breakpoints = Set(bps)

    attempt_to_set_f_breakpoints!(state.not_yet_set_function_breakpoints)
end

function getstacktrace_request(conn, state, msg_body, msg_id)
    @debug "getstacktrace_request"

    fr = state.frame

    curr_fr = JuliaInterpreter.leaf(fr)

    frames_as_string = String[]

    id = 1
    while curr_fr!==nothing
        curr_scopeof = JuliaInterpreter.scopeof(curr_fr)
        curr_whereis = JuliaInterpreter.whereis(curr_fr)

        file_name = curr_whereis[1]
        lineno = curr_whereis[2]
        meth_or_mod_name = Base.nameof(curr_fr)

        if isfile(file_name)
            push!(frames_as_string, string(id, ";", meth_or_mod_name, ";path;", file_name, ";", lineno))
        elseif curr_scopeof isa Method
            state.sources[state.next_source_id], loc = JuliaInterpreter.CodeTracking.definition(String, curr_fr.framecode.scope)
            s = string(id, ";", meth_or_mod_name, ";ref;", state.next_source_id, ";", file_name, ";", lineno)
            push!(frames_as_string, s)
            state.next_source_id += 1
        else
            # For now we are assuming that this can only happen
            # for code that is passed via the @enter or @run macros,
            # and that code we have stored as source with id 0
            s = string(id, ";", meth_or_mod_name, ";ref;", 0, ";", "REPL", ";", lineno)
            push!(frames_as_string, s)
        end
        
        id += 1
        curr_fr = curr_fr.caller
    end

    send_response(conn, msg_id, join(frames_as_string, '\n'))
end

function getscope_request(conn, state, msg_body, msg_id)
    @debug "getscope_request"

    frameId = parse(Int, msg_body)

    curr_fr = JuliaInterpreter.leaf(state.frame)

    i = 1

    while frameId > i
        curr_fr = curr_fr.caller
        i += 1
    end

    curr_scopeof = JuliaInterpreter.scopeof(curr_fr)
    curr_whereis = JuliaInterpreter.whereis(curr_fr)

    file_name = curr_whereis[1]
    code_range = curr_scopeof isa Method ? JuliaInterpreter.compute_corrected_linerange(curr_scopeof) : nothing

    if isfile(file_name) && code_range!==nothing
        send_response(conn, msg_id, "$(code_range.start);$(code_range.stop);$file_name")
    else
        send_response(conn, msg_id, "")
    end
end

function getsource_request(conn, state, msg_body, msg_id)
    @debug "getsource_request"

    source_id = parse(Int, msg_body)

    send_response(conn, msg_id, state.sources[source_id])
end

function getvariables_request(conn, state, msg_body, msg_id)
    @debug "getvariables_request"

    frameId = parse(Int, msg_body)

    fr = state.frame
    curr_fr = JuliaInterpreter.leaf(fr)

    i = 1

    while frameId > i
        curr_fr = curr_fr.caller
        i += 1
    end

    vars = JuliaInterpreter.locals(curr_fr)

    vars_as_string = String[]

    for v in vars
        # TODO Figure out why #self# is here in the first place
        # For now we don't report it to the client
        if !startswith(string(v.name), "#") && string(v.name)!=""
            push!(vars_as_string, string(v.name, ";", typeof(v.value), ";", v.value))
        end
    end

    if JuliaInterpreter.isexpr(JuliaInterpreter.pc_expr(curr_fr), :return)
        ret_val = JuliaInterpreter.get_return(curr_fr)
        push!(vars_as_string, string("Return Value", ";", typeof(ret_val), ";", ret_val))
    end

    send_response(conn, msg_id, join(vars_as_string, '\n'))
end

function evaluate_request(conn, state, msg_body, msg_id)
    @debug "evaluate_request"

    index_of_sep = findfirst(':', msg_body)

    stack_id = parse(Int, msg_body[1:index_of_sep-1])

    expression = msg_body[index_of_sep+1:end]

    curr_fr = state.frame
    curr_i = 1

    while stack_id > curr_i
        if curr_fr.caller!==nothing
            curr_fr = curr_fr.caller
            curr_i += 1
        else
            break
        end
    end

    try
        ret_val = JuliaInterpreter.eval_code(curr_fr, expression)

        send_response(conn, msg_id, string(ret_val))
    catch err
        send_response(conn, msg_id, "#error")
    end
end

function continue_request(conn, state, msg_body, msg_id)
    @debug "continue_request"

    ret = our_debug_command(:c, state)

    if ret===nothing
        send_notification(conn, "FINISHED")
        state.debug_mode==:launch && return :break
    else
        send_stopped_msg(conn, ret, state)
    end

    return
end

function next_request(conn, state, msg_body, msg_id)
    @debug "next_request"

    ret = our_debug_command(:n, state)

    if ret===nothing
        send_notification(conn, "FINISHED")
        state.debug_mode==:launch && return :break
    else
        send_stopped_msg(conn, ret, state)
    end

    return
end

function stepin_request(conn, state, msg_body, msg_id)
    @debug "stepin_request"

    ret = our_debug_command(:s, state)

    if ret===nothing
        send_notification(conn, "FINISHED")
        state.debug_mode==:launch && return :break
    else
        send_stopped_msg(conn, ret, state)
    end

    return
end

function stepout_request(conn, state, msg_body, msg_id)
    @debug "stepout_request"

    ret = our_debug_command(:finish, state)

    if ret===nothing
        send_notification(conn, "FINISHED")
        state.debug_mode==:launch && return :break
    else
        send_stopped_msg(conn, ret, state)
    end

    return
end

function disconnect_request(conn, state, msg_body, msg_id)
    @debug "disconnect_request"

    return :break
end

function terminate_request(conn, state, msg_body, msg_id)
    @debug "terminate_request"

    send_notification(conn, "FINISHED")
    return :break
end
