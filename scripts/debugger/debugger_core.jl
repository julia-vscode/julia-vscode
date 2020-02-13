mutable struct DebuggerState
    last_exception
    top_level_expressions::Vector{Any}
    current_top_level_expression::Int
    frame
    not_yet_set_function_breakpoints::Set{String}
    debug_mode::Symbol
    compile_mode
    sources::Dict{Int,String}
    next_source_id::Int

    function DebuggerState()
        return new(nothing, [], 0, nothing, Set{String}(), :unknown, JuliaInterpreter.finish_and_return!, Dict{Int,String}(), 1)
    end
end

is_toplevel_return(frame) = frame.framecode.scope isa Module && JuliaInterpreter.isexpr(JuliaInterpreter.pc_expr(frame), :return)

function attempt_to_set_f_breakpoints!(bps)
    for bp in bps
        @debug "Trying to set function breakpoint for '$(bp.name)'."
        try
            f = Core.eval(bp.mod, bp.name)

            signat = if bp.signature!==nothing
                Tuple{(Core.eval(Main, i) for i in bp.signature)...}
            else
                nothing
            end
            
            JuliaInterpreter.breakpoint(f, signat, bp.condition)
            delete!(bps, bp)

            @debug "Setting function breakpoint for '$(bp.name)' succeeded."
        catch err
            @debug "Setting function breakpoint for '$(bp.name)' failed."
        end
    end
end

function get_next_top_level_frame(state)
    state.current_top_level_expression += 1
    
    if state.current_top_level_expression > length(state.top_level_expressions)
        return nothing
    else
        next_top_level = state.top_level_expressions[state.current_top_level_expression]
        next_frame = JuliaInterpreter.prepare_thunk(next_top_level)
        return next_frame
    end
end

function our_debug_command(cmd, state)
    while true
        @debug "Running a new frame." state.frame state.compile_mode

        ret = Base.invokelatest(JuliaInterpreter.debug_command, state.compile_mode, state.frame, cmd, true)

        attempt_to_set_f_breakpoints!(state.not_yet_set_function_breakpoints)

        @debug "Finished running frame." ret

        if ret!==nothing && is_toplevel_return(ret[1])
            ret = nothing
        end

        if ret!==nothing
            state.frame = ret[1]
            return ret[2]
        end

        state.frame = get_next_top_level_frame(state)

        if state.frame===nothing
            return nothing
        end

        ret!==nothing && error("Invalid state.")

        if ret===nothing && (cmd==:n ||cmd==:s || cmd==:finish || JuliaInterpreter.shouldbreak(state.frame, state.frame.pc))
            return state.frame.pc
        end
    end
end

function send_stopped_msg(conn, ret_val, state)
    if ret_val isa JuliaInterpreter.BreakpointRef
        if ret_val.err===nothing
            send_notification(conn, "STOPPEDBP")
        else
            state.last_exception = ret_val.err
            send_notification(conn, "STOPPEDEXCEPTION", string(ret_val.err))
        end
    elseif ret_val isa Number
        send_notification(conn, "STOPPEDSTEP")
    elseif ret_val===nothing
        send_notification(conn, "STOPPEDSTEP")
    end
end
