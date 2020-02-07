module REPLDebugger

import JuliaInterpreter
import Sockets, Base64

function startdebug(pipename)

    # in_queue = Channel{Any}(Inf)
    # out_queue = Channel{Any}(Inf)

    conn = Sockets.connect(pipename)

    # @async try
    #     while true
    #         l = readline(conn)        

    #         i = findfirst(":", l)

    #         i===nothing && error()

    #         cmd = i[1:i.stop-1]
    #         payload = i[i.stop+1, end]

    #         push!(in_queue, (cmd=cmd, payload=payload))
    #     end
    # catch err
    #     Base.display_error, Base.catch_stack()
    # end

    @info "CONNECTED"

    l = readline(conn)

    while l!=""
        splitted_line = split(l, ';')

        line_as_num = parse(Int, splitted_line[2])
        file = splitted_line[1]

        @info "Setting one breakpoint at line $line_as_num in file $file"

        JuliaInterpreter.breakpoint(string(file), line_as_num)

        l = readline(conn)
    end

    @info "DONE WITH BREAKPOINTS"

    l = readline(conn)

    @info "NEXT COMMAND IS: $l"

    if startswith(l, "EXEC:")
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

        @info "Here are the bp:"

        @info JuliaInterpreter.breakpoints()

        frame = JuliaInterpreter.enter_call_expr(x)

        @info "FRAME WORKED"

        @info frame

        ret = JuliaInterpreter.debug_command(frame, :finish)
          
        @info "HEREREERER"

        if ret===nothing
            @info "WE ARE SENDING FINISHED"
            println(conn, "FINISHED")
        else
            fr, bpr = ret

            @info "NOW WE NEED TO SEND A ON STOP MSG"

            println(conn, "STOPPEDBP")    
        end


    end
end

end
