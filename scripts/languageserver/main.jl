if VERSION < v"0.5"
    error("VS Code julia language server only works with julia 0.5 or newer.")
end


user_pkg_dir = haskey(ENV, "JULIA_PKGDIR") ? ENV["JULIA_PKGDIR"] : joinpath(homedir(),".julia")
ls_debug_mode = true

function handle_flags(arg)
    if startswith(arg,"--")
        if arg=="--debug=no"
            global ls_debug_mode = false
        elseif arg=="--debug=yes"
            global ls_debug_mode = true
        else
            error("Unexpected flag argument: $(arg)")
        end
        true
    else
        false
    end
end

if length(Base.ARGS)>=1
    if !handle_flags(Base.ARGS[1])
        user_pkg_dir = Base.ARGS[1]
    end
    all(handle_flags, Base.ARGS[2:end]) || error("NonFlag argument not in first position. Arguments: $(Base.ARGS)")
end

conn = STDOUT
(outRead, outWrite) = redirect_stdout()

push!(LOAD_PATH, joinpath(dirname(@__FILE__),"packages"))
push!(LOAD_PATH, user_pkg_dir)

using Compat
using JSON
using Lint
using URIParser
using LanguageServer

server = LanguageServerInstance(STDIN,conn, ls_debug_mode, user_pkg_dir)
run(server)
