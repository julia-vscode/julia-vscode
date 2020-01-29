try
    include(ARGS[1])
catch err
    Base.display_error(stderr, err, catch_backtrace())
end

println();
println("Finished running, press ENTER to quit.");
readline()
