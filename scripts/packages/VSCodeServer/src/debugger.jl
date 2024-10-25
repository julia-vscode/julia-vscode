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
    quote
        let
            JSONRPC.send_notification(conn_endpoint[], "debugger/attach", (pipename=DEBUG_PIPENAME[], stopOnEntry=true))

            debug_session = wait_for_debug_session()

            DebugAdapter.debug_code(debug_session, Main, $(string(command)), $(string(__source__.file)))

            DebugAdapter.terminate(debug_session)

            # TODO Replace with return value

            nothing

            # DebugAdapter.startdebug(conn, function (err, bt)
            #     if is_disconnected_exception(err)
            #         @debug "connection closed"
            #     else
            #         printstyled(stderr, "Error while running the debugger", color = :red, bold = true)
            #         printstyled(stderr, " (consider adding a breakpoint for uncaught exceptions):\n", color = :red)
            #         Base.display_error(stderr, err, bt)
            #     end
            # end)
        end
    end
end

macro run(command)
    remove_lln!(command)
    quote
        let
            JSONRPC.send_notification(conn_endpoint[], "debugger/attach", (pipename=DEBUG_PIPENAME[], stopOnEntry=false))

            debug_session = wait_for_debug_session()

            DebugAdapter.debug_code(debug_session, Main, $(string(command)), $(string(__source__.file)))

            DebugAdapter.terminate(debug_session)

            # TODO Replace with return value
            nothing

            # DebugAdapter.startdebug(conn, function (err, bt)
            #     if is_disconnected_exception(err)
            #         @debug "connection closed"
            #     else
            #         printstyled(stderr, "Error while running the debugger", color = :red, bold = true)
            #         printstyled(stderr, " (consider adding a breakpoint for uncaught exceptions):\n", color = :red)
            #         Base.display_error(stderr, err, bt)
            #     end
            # end)
        end
    end
end

function start_debug_backend(debug_pipename, error_handler)
    @async try
        server = Sockets.listen(debug_pipename)

        while true
            conn = Sockets.accept(server)

            debug_session = DebugAdapter.DebugSession(conn)

            global DEBUG_SESSION

            put!(DEBUG_SESSION[], debug_session)

            try
                run(debug_session, error_handler)
            finally
                take!(DEBUG_SESSION[])
            end
        end
    catch err
        error_handler(err, Base.catch_backtrace())
    end
end

function wait_for_debug_session()
    fetch(DEBUG_SESSION[])
end
