repl_loadedModules_request(conn, params::Nothing) = string.(collect(get_modules()))

repl_isModuleLoaded_request(conn, params::String) = is_module_loaded(params)

function module_from_string(mod)
    ms = split(mod, '.')

    out = Main

    loaded_module = findfirst(==(first(ms)), string.(Base.loaded_modules_array()))

    if loaded_module !== nothing
        out = Base.loaded_modules_array()[loaded_module]
        popfirst!(ms)
    end

    for m in Symbol.(ms)
        if isdefined(out, m)
            resolved = getfield(out, m)

            if resolved isa Module
                out = resolved
            else
                return out
            end
        end
    end

    return out
end

is_module_loaded(mod) = mod == "Main" || module_from_string(mod) !== Main

function get_modules(toplevel=nothing, mods=Set(Module[]))
    top_mods = toplevel === nothing ? Base.loaded_modules_array() : [toplevel]

    for mod in top_mods
        push!(mods, mod)

        for name in names(mod, all=true)
            if !Base.isdeprecated(mod, name) && isdefined(mod, name)
                thismod = getfield(mod, name)
                if thismod isa Module && thismod !== mod && !(thismod in mods)
                    push!(mods, thismod)
                    get_modules(thismod, mods)
                end
            end
        end
    end
    mods
end
