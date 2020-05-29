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
    index_of_sep = our_findfirst(';', msg_body)

    stop_on_entry_as_string = msg_body[1:index_of_sep-1]

    stop_on_entry = stop_on_entry_as_string=="stopOnEntry=true"

    filename_to_debug = msg_body[index_of_sep+1:end]

    @debug "We are debugging the file $filename_to_debug."

    task_local_storage()[:SOURCE_PATH] = filename_to_debug

    ex = _parse_julia_file(filename_to_debug)

    # Empty file case
    if ex===nothing
        send_notification(conn, "FINISHED")
        return :break
    end

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

    index_of_sep = our_findfirst(';', msg_body)

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

    state.not_yet_set_function_breakpoints = Set{Any}(bps)

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

        # Is this a file from base?
        if !isabspath(file_name)
            file_name = basepath(file_name)
        end

        if isfile(file_name)
            push!(frames_as_string, string(id, ";", meth_or_mod_name, ";path;", file_name, ";", lineno))
        elseif curr_scopeof isa Method
            ret = JuliaInterpreter.CodeTracking.definition(String, curr_fr.framecode.scope)
            if ret!==nothing
                state.sources[state.next_source_id], loc = ret
                s = string(id, ";", meth_or_mod_name, ";ref;", state.next_source_id, ";", file_name, ";", lineno)
                push!(frames_as_string, s)
                state.next_source_id += 1
            else
                src = curr_fr.framecode.src
                src = JuliaInterpreter.copy_codeinfo(src)
                JuliaInterpreter.replace_coretypes!(src; rev=true)
                code = Base.invokelatest(JuliaInterpreter.framecode_lines, src)

                state.sources[state.next_source_id] = join(code, '\n')

                s = string(id, ";", meth_or_mod_name, ";ref;", state.next_source_id, ";", file_name, ";", lineno)
                push!(frames_as_string, s)
                state.next_source_id += 1
            end
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

function getscope_request(conn, state::DebuggerState, msg_body, msg_id)
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

    push!(state.varrefs, VariableReference(:scope, curr_fr))

    var_ref_id = length(state.varrefs)

    if isfile(file_name) && code_range!==nothing
        send_response(conn, msg_id, "Local;$var_ref_id;$(code_range.start);$(code_range.stop);$file_name")
    else
        send_response(conn, msg_id, "Local;$var_ref_id")
    end
end

function getsource_request(conn, state, msg_body, msg_id)
    @debug "getsource_request"

    source_id = parse(Int, msg_body)

    send_response(conn, msg_id, state.sources[source_id])
end

function construct_return_msg_for_var(state::DebuggerState, name, value)
    v_type = typeof(value)
    v_type_as_string = string(v_type)
    v_value_as_string = Base.invokelatest(repr, value)
    v_value_encoded = Base64.base64encode(v_value_as_string)

    if (isstructtype(v_type) || value isa AbstractArray || value isa AbstractDict) && !(value isa String || value isa Symbol)
        push!(state.varrefs, VariableReference(:var, value))
        new_var_id = length(state.varrefs)

        named_count = if value isa Array || value isa Tuple
            0
        elseif value isa AbstractArray || value isa AbstractDict
            fieldcount(v_type) > 0 ? 1 : 0
        else
            fieldcount(v_type)
        end

        indexed_count = 0

        if value isa AbstractArray || value isa AbstractDict || value isa Tuple
            try
                indexed_count = Base.invokelatest(length, value)
            catch err
            end
        end

        return string(new_var_id, ";", name, ";", v_type_as_string, ";", named_count, ";", indexed_count, ";", v_value_encoded)
    else
        return string("0;", name, ";", v_type_as_string, ";0;0;", v_value_encoded)
    end
end

function construct_return_msg_for_var_with_undef_value(state::DebuggerState, name)
    v_type_as_string = ""
    v_value_encoded = Base64.base64encode("#undef")
    
    return string("0;", name, ";", v_type_as_string, ";0;0;", v_value_encoded)
end

function get_keys_with_drop_take(value, skip_count, take_count)
    collect(Iterators.take(Iterators.drop(keys(value), skip_count), take_count))
end

function get_cartesian_with_drop_take(value, skip_count, take_count)
    collect(Iterators.take(Iterators.drop(CartesianIndices(value), skip_count), take_count))
end

function getvariables_request(conn, state::DebuggerState, msg_body, msg_id)
    @debug "getvariables_request"

    parts =split(msg_body, ';')

    var_ref_id = parse(Int, parts[1])

    filter_type = parts[2]
    skip_count = parts[3] == "" ? 0 : parse(Int, parts[3])
    take_count = parts[4] == "" ? typemax(Int) : parse(Int, parts[4])

    var_ref = state.varrefs[var_ref_id]

    vars_as_string = String[]

    if var_ref.kind==:scope
        curr_fr = var_ref.value

        vars = JuliaInterpreter.locals(curr_fr)      

        for v in vars
            # TODO Figure out why #self# is here in the first place
            # For now we don't report it to the client
            if !startswith(string(v.name), "#") && string(v.name)!=""
                s = construct_return_msg_for_var(state, string(v.name), v.value)
                push!(vars_as_string, s)
            end
        end

        if JuliaInterpreter.isexpr(JuliaInterpreter.pc_expr(curr_fr), :return)
            ret_val = JuliaInterpreter.get_return(curr_fr)
            s = construct_return_msg_for_var(state, "Return Value", ret_val)
            
            push!(vars_as_string, s)
        end        
    elseif var_ref.kind==:var
        container_type = typeof(var_ref.value)

        if filter_type=="" || filter_type=="named"
            if (var_ref.value isa AbstractArray || var_ref.value isa AbstractDict) && !(var_ref.value isa Array) &&
                fieldcount(container_type) > 0
                push!(state.varrefs, VariableReference(:fields, var_ref.value))
                new_var_id = length(state.varrefs)
                named_count = fieldcount(container_type)
                s = string(new_var_id, ";Fields;;", named_count, ";0;", Base64.base64encode(""))
                
                push!(vars_as_string, s)
            else
                for i=Iterators.take(Iterators.drop(1:fieldcount(container_type), skip_count), take_count)
                    s = isdefined(var_ref.value, i) ?
                        construct_return_msg_for_var(state, string(fieldname(container_type, i)), getfield(var_ref.value, i) ) :
                        construct_return_msg_for_var_with_undef_value(state, string(fieldname(container_type, i)))
                    push!(vars_as_string, s)
                end
            end
        end

        if (filter_type=="" || filter_type=="indexed") 
            if var_ref.value isa Tuple
                for i in Iterators.take(Iterators.drop(1:length(var_ref.value), skip_count), take_count)
                    s = construct_return_msg_for_var(state, join(string.(i), ','), var_ref.value[i])
                    push!(vars_as_string, s)
                end
            elseif var_ref.value isa AbstractArray
                for i in Base.invokelatest(get_cartesian_with_drop_take, var_ref.value, skip_count, take_count)
                    try
                        val = Base.invokelatest(getindex, var_ref.value, i)
                        s = construct_return_msg_for_var(state, join(string.(i.I), ','), val)
                    catch err
                        s = string("0;", join(string.(i.I), ','), ";;0;0;", Base64.base64encode("#error"))
                    end                    
                    push!(vars_as_string, s)
                end
            elseif var_ref.value isa AbstractDict
                for i in Base.invokelatest(get_keys_with_drop_take, var_ref.value, skip_count, take_count)
                    key_as_string = Base.invokelatest(repr, i)
                    try
                        val = Base.invokelatest(getindex, var_ref.value, i)
                        s = construct_return_msg_for_var(state, key_as_string, val)
                    catch err
                        s = string("0;", join(string.(i.I), ','), ";;0;0;", Base64.base64encode("#error"))
                    end                    
                    push!(vars_as_string, s)
                end
            end
        end
    elseif var_ref.kind==:fields
        container_type = typeof(var_ref.value)

        if filter_type=="" || filter_type=="named"
            for i=Iterators.take(Iterators.drop(1:fieldcount(container_type), skip_count), take_count)
                s = isdefined(var_ref.value, i) ?
                    construct_return_msg_for_var(state, string(fieldname(container_type, i)), getfield(var_ref.value, i) ) :
                    construct_return_msg_for_var_with_undef_value(state, string(fieldname(container_type, i)))
                push!(vars_as_string, s)
            end
        end

    end

    send_response(conn, msg_id, join(vars_as_string, '\n'))
end

function setvariable_request(conn, state::DebuggerState, msg_body, msg_id)
    parts = split(msg_body, ';')

    varref_id = parse(Int, parts[1])
    var_name = String(Base64.base64decode(parts[2]))
    var_value = String(Base64.base64decode(parts[3]))

    val_parsed = try
        parsed = Meta.parse(var_value)

        if parsed isa Expr && !(parsed.head==:call || parsed.head==:vect || parsed.head==:tuple)
            send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Only values or function calls are allowed."))")
            return    
        end

        parsed
    catch err
        send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Something went wrong in the eval."))")
        return
    end    

    var_ref = state.varrefs[varref_id]

    if var_ref.kind==:scope
        try
            ret = JuliaInterpreter.eval_code(var_ref.value, "$var_name = $var_value");

            s = construct_return_msg_for_var(state::DebuggerState, "", ret)

            send_response(conn, msg_id, "SUCCESS;$s")
            return
        catch err
            send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Something went wrong in the set: $err"))")
            return
        end
    elseif var_ref.kind==:var
        if isnumeric(var_name[1])
            try
                new_val = try
                    Core.eval(Main, val_parsed)
                catch err
                    send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Expression cannot be evaluated."))")
                    return
                end

                idx = Core.eval(Main, Meta.parse("($var_name)"))

                setindex!(var_ref.value, new_val, idx...)

                s = construct_return_msg_for_var(state::DebuggerState, "", new_val)

                send_response(conn, msg_id, "SUCCESS;$s")
                return
            catch err
                send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Something went wrong in the set: $err"))")
                return
            end
        else
            if Base.isimmutable(var_ref.value)
                send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Cannot change the fields of an immutable struct."))")
                return
            else
                try
                    new_val = try
                        Core.eval(Main, val_parsed)
                    catch err
                        send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Expression cannot be evaluated."))")
                        return
                    end

                    setfield!(var_ref.value, Symbol(var_name), new_val)

                    s = construct_return_msg_for_var(state::DebuggerState, "", new_val)

                    send_response(conn, msg_id, "SUCCESS;$s")
                    return
                catch err
                    send_response(conn, msg_id, "FAILED;$(Base64.base64encode("Something went wrong in the set: $err"))")
                    return
                end
            end
        end
    else
        error("Unknown var ref type.")
    end    
end

function restartframe_request(conn, state::DebuggerState, msg_body, msg_id)
    frame_id = parse(Int, msg_body)

    curr_fr = JuliaInterpreter.leaf(state.frame)

    i = 1

    while frame_id > i
        curr_fr = curr_fr.caller
        i += 1
    end

    if curr_fr.caller===nothing
        # We are in the top level

        state.current_top_level_expression = 0

        state.frame = get_next_top_level_frame(state)    
    else
        curr_fr.pc = 1
        curr_fr.assignment_counter = 1
        curr_fr.callee = nothing

        state.frame = curr_fr
    end

    ret = our_debug_command(:c, state)

    if ret===nothing
        send_notification(conn, "FINISHED")
        state.debug_mode==:launch && return :break
    else
        send_stopped_msg(conn, ret, state)
    end

    return
end

function getexceptioninfo_request(conn, state, msg_body, msg_id)
    exception_id = string(typeof(state.last_exception))
    exception_description = sprint(Base.showerror, state.last_exception)

    exception_stacktrace = sprint(Base.show_backtrace, state.frame)
    
    send_response(conn, msg_id, string(Base64.base64encode(exception_id), ';', Base64.base64encode(exception_description), ';', Base64.base64encode(exception_stacktrace)))
end

function evaluate_request(conn, state, msg_body, msg_id)
    @debug "evaluate_request"

    index_of_sep = our_findfirst(':', msg_body)

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

        send_response(conn, msg_id, Base.invokelatest(repr, ret_val))
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
