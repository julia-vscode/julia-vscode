module VSCodeDebugger

include("../terminalserver/repl.jl")

# Small hack to fool the linter
JuliaInterpreter = nothing

# This patches JuliaInterpreter.jl to use our private copy of CodeTracking.jl
filename_of_juliainterpreter = joinpath(@__DIR__, "packages", "JuliaInterpreter", "src", "JuliaInterpreter.jl")
filename_of_codetracking = joinpath(@__DIR__, "packages", "CodeTracking", "src", "CodeTracking.jl")
filename_of_codetracking = replace(filename_of_codetracking, "\\"=>"\\\\")
jlinterp_code = read(filename_of_juliainterpreter, String)
jlinterp_code_patched = replace(jlinterp_code, "using CodeTracking"=>"include(\"$filename_of_codetracking\"); using .CodeTracking")
withpath(filename_of_juliainterpreter) do
    include_string(VSCodeDebugger, jlinterp_code_patched, filename_of_juliainterpreter)
end

import .JuliaInterpreter
import Sockets, Base64

include("debugger_rcp.jl")
include("debugger_utils.jl")
include("debugger_core.jl")
include("debugger_requests.jl")

function clean_up_ARGS_in_launch_mode()
    pipename = ARGS[1]
    deleteat!(ARGS, 1)

    if ENV["JL_ARGS"] != ""
        cmd_ln_args_encoded = split(ENV["JL_ARGS"], ';')

        delete!(ENV, "JL_ARGS")

        cmd_ln_args_decoded = map(i->String(Base64.base64decode(i)), cmd_ln_args_encoded)

        for arg in cmd_ln_args_decoded
            push!(ARGS, arg)
        end
    end

    return pipename
end

function startdebug(pipename)
    @debug "Trying to connect to debug adapter."
    conn = Sockets.connect(pipename)
    @debug "Connected to debug adapter."
    try
        state = DebuggerState()     

        request_handlers = Dict{String,Function}()
        request_handlers["DISCONNECT"] = disconnect_request
        request_handlers["RUN"] = run_request
        request_handlers["DEBUG"] = debug_request
        request_handlers["EXEC"] = exec_request
        request_handlers["SETBREAKPOINTS"] = setbreakpoints_request
        request_handlers["SETEXCEPTIONBREAKPOINTS"] = setexceptionbreakpoints_request
        request_handlers["SETFUNCBREAKPOINTS"] = setfunctionbreakpoints_request
        request_handlers["GETSTACKTRACE"] = getstacktrace_request
        request_handlers["GETSCOPE"] = getscope_request
        request_handlers["GETSOURCE"] = getsource_request
        request_handlers["GETVARIABLES"] = getvariables_request
        request_handlers["CONTINUE"] = continue_request
        request_handlers["NEXT"] = next_request
        request_handlers["STEPIN"] = stepin_request
        request_handlers["STEPOUT"] = stepout_request
        request_handlers["EVALUATE"] = evaluate_request
        request_handlers["TERMINATE"] = terminate_request

        while true
            @debug "Waiting for next command from debug adapter."
            le = readline(conn)
            
            msg_id, msg_cmd, msg_body = decode_msg(le)

            @debug "Received command '$msg_cmd' from debug adapter."

            if haskey(request_handlers, msg_cmd)
                ret_val = request_handlers[msg_cmd](conn, state, msg_body, msg_id)

                ret_val == :break && break
            else
                error("Unknown debug command.")
            end
        end

        @debug "Finished debugging"
    finally
        close(conn)
    end
end

end
