function repl_startdebugger_request(conn, params::String, crashreporting_pipename)
    hideprompt() do
        debug_pipename = params
        try
            DebugAdapter.startdebug(debug_pipename)
        catch err
            DebugAdapter.global_err_handler(err, catch_backtrace(), crashreporting_pipename, "Debugger")
        end
    end
end

function remove_lln!(ex::Expr)
    for i in length(ex.args):-1:1
        if ex.args[i] isa LineNumberNode
            deleteat!(ex.args, i)
        elseif ex.args[i] isa Expr
            remove_lln!(ex.args[i])
        end
    end
end

macro enter(command)
    remove_lln!(command)
    :(JSONRPC.send_notification(conn_endpoint[], "debugger/enter", $(string(command))))
end

macro run(command)
    remove_lln!(command)
    :(JSONRPC.send_notification(conn_endpoint[], "debugger/run", $(string(command))))
end
