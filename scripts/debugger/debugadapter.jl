@info "DOES THIS RUN??"

open(joinpath(homedir(), "zTHISDIDRUN.txt"), "w") do f
    println(f, "IT DID")
end
