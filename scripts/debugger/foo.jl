# @info "DOES THIS RUN??"

open(joinpath(homedir(), "zzzDIDTHISHAPPEN.txt"), "w") do f
    println(f, "IT DID")
end
