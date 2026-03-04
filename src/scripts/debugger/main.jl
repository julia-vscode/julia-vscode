include("types.jl")
include("higher_order_functions.jl")
include("higher_order_examples.jl")

sig_hofs = find_higher_order_functions()
excluded = Set([HOFEntry(Base, :atexit), HOFEntry(Base, :finalizer), HOFEntry(Base, :_include)])
stack_hofs = run_examples(@__MODULE__; extra_hofs=filter(n -> n ∉ excluded, sig_hofs))

all_hofs = sort!(collect(union(sig_hofs, stack_hofs)))

v = "$(VERSION.major).$(VERSION.minor)"
outfile = joinpath(@__DIR__, "hofs_$v.txt")
open(outfile, "w") do io
    for name in all_hofs
        name.mod === Main && continue
        println(io, name)
    end
end
println("Wrote $(length(all_hofs)) functions to $outfile")
