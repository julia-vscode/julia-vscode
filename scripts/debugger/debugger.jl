module VSCodeDebugger

include("../terminalserver/repl.jl")

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

@inline function _parse_julia_file(filename::String)
    _filename = realpath(filename)
    _filename = filename
    file_contents::String = read(_filename, String)::String
    block = Meta.parse("begin\n $(file_contents)\n end\n")
    fixed_block = _fix_filename(block, _filename)
    lines = fixed_block.args
    return fixed_block
    return lines
end

@inline function _fix_filename(expr::Expr, filename::String)
    return Expr(expr.head, _fix_filename.(expr.args, filename)...)
end

@inline function _fix_filename(sym, filename::String)
    return sym
end

@inline function _fix_filename(lnn::LineNumberNode, filename::String)
    return LineNumberNode(lnn.line-1, filename)
end

function our_debug_command(frame, cmd, modexs)
    ret = nothing
    while true
        @debug "Now running the following FRAME:"
        @debug frame

        ret = JuliaInterpreter.debug_command(frame, cmd, true)

        # @debug "We got $ret"

        if ret!==nothing || length(modexs)==0
            break
        end

        frame = JuliaInterpreter.prepare_thunk(modexs[1])
        deleteat!(modexs, 1)

        if ret===nothing && cmd==:n
            ret = (frame, nothing)
            break
        end
    end

    return ret
end

function decode_msg(line::AbstractString)
    pos = findfirst(':', line)
    if pos===nothing
        return line, ""
    else
        msg_cmd = line[1:pos-1]
        msg_body_encoded = line[pos+1:end]
        msg_body = String(Base64.base64decode(msg_body_encoded))
        return msg_cmd, msg_body
    end
end

function send_msg(conn, msg_cmd::AbstractString, msg_body::Union{AbstractString,Nothing}=nothing)
    if msg_body===nothing
        println(conn, msg_cmd)
    else
        encoded_msg_body = Base64.base64encode(msg_body)
        println(conn, msg_cmd, ':', encoded_msg_body)
    end
end

function startdebug(pipename)
    conn = Sockets.connect(pipename)
    try
        modexs = []
        frame = nothing

        while true      
            @debug "Current FRAME is"    
            @debug frame
            @debug "NOW WAITING FOR COMMAND FROM DAP"
            le = readline(conn)

            msg_cmd, msg_body = decode_msg(le)
            
            @debug "COMMAND is '$le'"

            if msg_cmd=="DISCONNECT"
                @debug "DISCONNECT"
                break
            elseif msg_cmd=="RUN"
                @debug "WE ARE RUNNING"
                try
                    include(msg_body)
                catch err
                    Base.display_error(stderr, err, catch_backtrace())
                end

                send_msg(conn, "FINISHED")                
                break
            elseif msg_cmd=="DEBUG"
                filename_to_debug = msg_body

                @debug "We are debugging $filename_to_debug"

                ex = _parse_julia_file(filename_to_debug)

                @debug typeof(ex)
                @debug ex

                modexs, _ = JuliaInterpreter.split_expressions(Main, ex)

                frame = JuliaInterpreter.prepare_thunk(modexs[1])
                deleteat!(modexs, 1)

                ret = our_debug_command(frame, :finish, modexs)

                if ret===nothing
                    send_msg(conn, "FINISHED")
                    break
                else
                    frame = ret[1]
                    send_msg(conn, "STOPPEDBP")
                end
            elseif msg_cmd=="EXEC"
                @debug "WE ARE EXECUTING"
    
                ex = Meta.parse(msg_body)

                modexs, _ = JuliaInterpreter.split_expressions(Main, ex)
    
                frame = JuliaInterpreter.prepare_thunk(modexs[1])
                deleteat!(modexs, 1)
    
                ret = our_debug_command(frame, :finish, modexs)

                if ret===nothing
                    @debug "WE ARE SENDING FINISHED"
                    send_msg(conn, "FINISHED")
                    break
                else
                    @debug "NOW WE NEED TO SEND A ON STOP MSG"
                    frame = ret[1]
                    send_msg(conn, "STOPPEDBP")
                end                
            elseif msg_cmd=="TERMINATE"
                send_msg(conn, "FINISHED")
                break
            elseif msg_cmd=="SETBREAKPOINTS"
                splitted_line = split(msg_body, ';')

                lines_as_num = parse.(Int, splitted_line[2:end])
                file = splitted_line[1]

                for bp in JuliaInterpreter.breakpoints()
                    if bp isa JuliaInterpreter.BreakpointFileLocation
                        if bp.path==file
                            JuliaInterpreter.remove(bp)
                        end
                    end
                end
    
                for line_as_num in lines_as_num
                    @debug "Setting one breakpoint at line $line_as_num in file $file"
    
                    JuliaInterpreter.breakpoint(string(file), line_as_num)                        
                end
            elseif msg_cmd=="SETEXCEPTIONBREAKPOINTS"
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
            elseif msg_cmd=="SETFUNCBREAKPOINTS"
                @debug "SETTING FUNC BREAKPOINT"                

                func_names = split(msg_body, ';', keepempty=false)

                @debug func_names

                for bp in JuliaInterpreter.breakpoints()
                    if bp isa JuliaInterpreter.BreakpointSignature
                        JuliaInterpreter.remove(bp)
                    end
                end

                for func_name in func_names
                    @debug "setting func breakpoint for $func_name"
                    f = Main.eval(Meta.parse(func_name))
                    @debug "Setting breakpoint for $f"
                    JuliaInterpreter.breakpoint(f)
                end
            elseif msg_cmd=="GETSTACKTRACE"
                @debug "Stacktrace requested"

                fr = frame

                curr_fr = JuliaInterpreter.leaf(fr)

                frames_as_string = String[]

                id = 1
                while curr_fr!==nothing
                    @debug "UUUUUU"

                    @debug JuliaInterpreter.scopeof(curr_fr)
                    @debug typeof(JuliaInterpreter.scopeof(curr_fr))
                    @debug JuliaInterpreter.whereis(curr_fr)
                    @debug typeof(JuliaInterpreter.whereis(curr_fr))

                    # This can be either a Method or a Module
                    curr_scopeof = JuliaInterpreter.scopeof(curr_fr)
                    curr_whereis = JuliaInterpreter.whereis(curr_fr)
                    # TODO This is a bug fix, for some reason curr_whereis[1]
                    # returns a truncated filename
                    fname = curr_fr.framecode.src.linetable[1].file

                    push!(frames_as_string, string(id, ";", curr_scopeof isa Method ? curr_scopeof.name : string(curr_scopeof), ";", fname, ";", curr_whereis[2]))
                    id += 1
                    curr_fr = curr_fr.caller
                end

                send_msg(conn, "RESULT", join(frames_as_string, '\n'))
                @debug "DONE SENDING stacktrace"
            elseif msg_cmd=="GETVARIABLES"
                @debug "START VARS"

                frameId = parse(Int, msg_body)

                fr = frame
                curr_fr = JuliaInterpreter.leaf(fr)

                i = 1

                while frameId > i
                    curr_fr = curr_fr.caller
                    i += 1
                end

                vars = JuliaInterpreter.locals(curr_fr)

                vars_as_string = String[]

                for v in vars
                    push!(vars_as_string, string(v.name, ";", v.value))
                end

                send_msg(conn, "RESULT", join(vars_as_string, '\n'))
                @debug "DONE VARS"
            elseif msg_cmd=="CONTINUE"
                ret = our_debug_command(frame, :c, modexs)

                if ret===nothing
                    @debug "WE ARE SENDING FINISHED"
                    send_msg(conn, "FINISHED")
                    break
                else
                    @debug "NOW WE NEED TO SEND A ON STOP MSG"
                    frame = ret[1]
                    send_msg(conn, "STOPPEDBP")
                end
            elseif msg_cmd=="NEXT"
                @debug "NEXT COMMAND"
                ret = our_debug_command(frame, :n, modexs)

                if ret===nothing
                    @debug "WE ARE SENDING FINISHED"
                    send_msg(conn, "FINISHED")
                    break
                else
                    @debug "NOW WE NEED TO SEND A ON STOP MSG"
                    frame = ret[1]
                    send_msg(conn, "STOPPEDBP")
                end
            elseif msg_cmd=="STEPIN"
                @debug "STEPIN COMMAND"
                ret = our_debug_command(frame, :s, modexs)

                if ret===nothing
                    @debug "WE ARE SENDING FINISHED"
                    send_msg(conn, "FINISHED")
                    break
                else
                    @debug "NOW WE NEED TO SEND A ON STOP MSG"
                    frame = ret[1]
                    send_msg(conn, "STOPPEDBP")
                end
            elseif msg_cmd=="STEPOUT"
                @debug "STEPOUT COMMAND"
                ret = our_debug_command(frame, :finish, modexs)

                if ret===nothing
                    @debug "WE ARE SENDING FINISHED"
                    send_msg(conn, "FINISHED")
                    break
                else
                    @debug "NOW WE NEED TO SEND A ON STOP MSG"
                    frame = ret[1]
                    send_msg(conn, "STOPPEDBP")
                end
            end
        end
    finally
        close(conn)
    end
end

end
