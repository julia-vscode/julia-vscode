module REPLDebugger

import JuliaInterpreter
import Sockets, Base64

function startdebug(pipename)
    conn = Sockets.connect(pipename)
    try
        ret = nothing
        while true          
            @info "NOW WAITING FOR COMMAND FROM DAP"
            l = readline(conn)
            @info "COMMAND is '$l'"

            if l=="DISCONNECT"
                @info "DISCONNECT"
                break
            elseif startswith(l, "EXEC:")
                @info "WE ARE EXECUTING"
                encoded_code = l[6:end]
                decoded_code = String(Base64.base64decode(encoded_code))
                @info decoded_code
    
                x = Meta.parse(decoded_code)
    
                @info "OK: $x"
    
                y = Main.eval(x.args[1])
    
                @info "Y: $y"
    
                x.args[1]=y
    
                @info "NOW: $x"
    
                frame = JuliaInterpreter.enter_call_expr(x)
    
                @info "FRAME WORKED"
    
                @info frame
    
                ret = JuliaInterpreter.debug_command(frame, :finish)

                if ret===nothing
                    @info "WE ARE SENDING FINISHED"
                    println(conn, "FINISHED")
                    break
                else
                    @info "NOW WE NEED TO SEND A ON STOP MSG"
                    println(conn, "STOPPEDBP")
                end
            elseif startswith(l, "SETBREAKPOINTS:")
                payload = l[16:end]

                splitted_line = split(payload, ';')

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
                    @info "Setting one breakpoint at line $line_as_num in file $file"
    
                    JuliaInterpreter.breakpoint(string(file), line_as_num)                        
                end
            elseif startswith(l, "SETEXCEPTIONBREAKPOINTS:")
                payload = l[25:end]

                opts = Set(split(payload, ';'))

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
            elseif startswith(l, "SETFUNCBREAKPOINTS:")
                @info "SETTING FUNC BREAKPOINT"                
                payload = l[20:end]

                @info "Payload '$payload'"

                func_names = split(payload, ';', keepempty=false)

                @info func_names

                for bp in JuliaInterpreter.breakpoints()
                    if bp isa JuliaInterpreter.BreakpointSignature
                        JuliaInterpreter.remove(bp)
                    end
                end

                for func_name in func_names
                    @info "setting func breakpoint for $func_name"
                    f = Main.eval(Meta.parse(func_name))
                    @info "Setting breakpoint for $f"
                    JuliaInterpreter.breakpoint(f)
                end
            elseif l=="GETSTACKTRACE"
                @info "Stacktrace requested"

                fr, bpr = ret

                curr_fr = JuliaInterpreter.leaf(fr)

                frames_as_string = String[]

                while curr_fr!==nothing
                    push!(frames_as_string, string(JuliaInterpreter.scopeof(curr_fr).name, ";", JuliaInterpreter.whereis(curr_fr)[1], ";", JuliaInterpreter.whereis(curr_fr)[2]))

                    curr_fr = curr_fr.caller
                end

                encoded_version = Base64.base64encode(join(frames_as_string, '\n'))

                println(conn, "RESULT:$encoded_version\n")
                @info "DONE SENDING stacktrace"
            elseif l=="CONTINUE"
                ret = JuliaInterpreter.debug_command(ret[1], :c)

                if ret===nothing
                    @info "WE ARE SENDING FINISHED"
                    println(conn, "FINISHED")
                    break
                else
                    @info "NOW WE NEED TO SEND A ON STOP MSG"
                    println(conn, "STOPPEDBP")
                end
            elseif l=="NEXT"
                @info "NEXT COMMAND"
                ret = JuliaInterpreter.debug_command(ret[1], :n)

                if ret===nothing
                    @info "WE ARE SENDING FINISHED"
                    println(conn, "FINISHED")
                    break
                else
                    @info "NOW WE NEED TO SEND A ON STOP MSG"
                    println(conn, "STOPPEDBP")
                end
            elseif l=="STEPIN"
                @info "STEPIN COMMAND"
                ret = JuliaInterpreter.debug_command(ret[1], :s)

                if ret===nothing
                    @info "WE ARE SENDING FINISHED"
                    println(conn, "FINISHED")
                    break
                else
                    @info "NOW WE NEED TO SEND A ON STOP MSG"
                    println(conn, "STOPPEDBP")
                end
            elseif l=="STEPOUT"
                @info "STEPOUT COMMAND"
                ret = JuliaInterpreter.debug_command(ret[1], :finish)

                if ret===nothing
                    @info "WE ARE SENDING FINISHED"
                    println(conn, "FINISHED")
                    break
                else
                    @info "NOW WE NEED TO SEND A ON STOP MSG"
                    println(conn, "STOPPEDBP")
                end
            end
        end
    finally
        close(conn)
    end
end

end
