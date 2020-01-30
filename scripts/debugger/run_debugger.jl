module _vscdebuggeg

import JuliaInterpreter
import Sockets

try
    conn = Sockets.connect(ARGS[1])

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

    if startswith(l, "RUN:")
        @info "WE ARE RUNNING"
        include(l[5:end])
    elseif startswith(l, "DEBUG:")
        @info "WE ARE DEBUGGING"
        res = JuliaInterpreter.@interpret include(l[7:end])

        @show res
    end  

    catch err
        Base.display_error(stderr, err, catch_backtrace())
    end

    println();
    println("Finished running, press ENTER to quit.");
    readline()

end
