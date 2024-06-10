function repl_startdebugger_request(conn, params::NamedTuple{(:debugPipename,),Tuple{String}}, crashreporting_pipename)
    hideprompt() do
        debug_pipename = params.debugPipename
        try
            @debug "Trying to connect to debug adapter."
            socket = Sockets.connect(debug_pipename)
            try
                DebugAdapter.startdebug(socket, function (err, bt)
                        if is_disconnected_exception(err)
                            @debug "connection closed"
                        else
                            printstyled(stderr, "Error while running the debugger", color = :red, bold = true)
                            printstyled(stderr, " (consider adding a breakpoint for uncaught exceptions):\n", color = :red)
                            Base.display_error(stderr, err, bt)
                        end
                    end)
            finally
                close(socket)
            end
        catch err
            global_err_handler(err, catch_backtrace(), crashreporting_pipename, "Debugger")
        end
    end
end

function remove_lln!(ex::Expr)
    for i = length(ex.args):-1:1
        if ex.args[i] isa LineNumberNode
            deleteat!(ex.args, i)
        elseif ex.args[i] isa Expr
            remove_lln!(ex.args[i])
        end
    end
end

function debugger_getdebugitems_request(conn, params)
    accessor = params.juliaAccessor
    out = DebugConfigTreeItem[]
    loaded_modules = Base.loaded_modules_array()
    if accessor == "#root"
        # root modules
        for mod in loaded_modules
            push!(out, DebugConfigTreeItem(string(mod), true, string(mod)))
        end
    else
        obj = get_obj_by_accessor(accessor)
        if obj isa Module
            for name in names(obj; all = true)
                isdefined(obj, name) || continue
                strname = string(name)
                startswith(strname, '#') && continue
                this = getfield(obj, name)
                this === obj && continue

                if this isa Base.Callable || this isa Module
                    push!(out, DebugConfigTreeItem(strname, this isa Module, string(accessor, ".", strname)))
                end
            end
        end
    end
    return sort!(out, lt = (x, y) -> x.hasChildren == y.hasChildren ? x.label < y.label : x.hasChildren)
end

function get_obj_by_accessor(accessor, super = nothing)
    parts = split(accessor, '.')
    @assert length(parts) > 0
    top = popfirst!(parts)
    if super === nothing
        # try getting module from loaded_modules_array first and then from Main:
        loaded_modules = Base.loaded_modules_array()
        ind = findfirst(==(top), string.(loaded_modules))
        if ind !== nothing
            root = loaded_modules[ind]
            if length(parts) > 0
                return get_obj_by_accessor(join(parts, '.'), root)
            end
            return root
        else
            return get_obj_by_accessor(accessor, Main)
        end
    else
        if isdefined(super, Symbol(top))
            this = getfield(super, Symbol(top))
            if length(parts) > 0
                if this isa Module
                    return get_obj_by_accessor(join(parts, '.'), this)
                end
            else
                return this
            end
        end
    end
    return nothing
end

macro enter(command)
    remove_lln!(command)
    :(JSONRPC.send_notification(conn_endpoint[], "debugger/enter", (code = $(string(command)), filename = $(string(__source__.file)))))
end

function generate_pipe_name(pid::String, name::String)
    if Sys.iswindows()
        return "\\\\.\\pipe\\$name-$pid"
    else
        return join(tempdir(), "$name-$pid")
    end
end

macro run(command)
    remove_lln!(command)
    quote
        let
            hideprompt() do
                pipename = generate_pipe_name(string(uuid4()), "jlrepldbg")
                server = Sockets.listen(pipename)
                try
                    JSONRPC.send_notification(conn_endpoint[], "debugger/run", (code = $(string(command)), filename = $(string(__source__.file)), pipename=pipename))

                    conn = Sockets.accept(server)
                    try
                        println("ABouT TO START DEBUG SESSION")
                        DebugAdapter.startdebug(conn, function (err, bt)
                            if is_disconnected_exception(err)
                                @debug "connection closed"
                            else
                                printstyled(stderr, "Error while running the debugger", color = :red, bold = true)
                                printstyled(stderr, " (consider adding a breakpoint for uncaught exceptions):\n", color = :red)
                                Base.display_error(stderr, err, bt)
                            end
                        end)

                        println("WE FINISHED")
                    finally
                        close(conn)
                    end
                finally
                    close(server)
                end
            end
        end
    end
end
