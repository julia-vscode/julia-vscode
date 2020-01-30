module REPLDebugger

import JuliaInterpreter
import Sockets, Base64

function startdebug(pipename)

    conn = Sockets.connect(pipename)

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

            frame = JuliaInterpreter.enter_call_expr(x)

        @info "FRAME WORKED"

        @info frame

        ret = JuliaInterpreter.finish_and_return!(frame)
          
            @info "HEREREERER"


            @info ret

        asdf = :(JuliaInterpreter.@interpret $(Meta.parse(decoded_code)))
        @info asdf
        try
            res = Main.eval(asdf)
            @info "DID WE make it?"
            @show res
        catch err
            @info "SOMETHING WENG WRONG"
        end
    end
end

end
