pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeLiveUnitTesting
popfirst!(LOAD_PATH)

# TODO Somehow instantiate and activate the test environment that we need here

VSCodeLiveUnitTesting.Revise.track(joinpath(pwd(), "test", "runtests.jl"); mode=:eval, skip_include=false)

VSCodeLiveUnitTesting.Revise.entr([joinpath(pwd(), "test", "runtests.jl")]; all=true, postpone=true) do
    try
        VSCodeLiveUnitTesting.Revise.include(joinpath(pwd(), "test", "runtests.jl"))
    catch err
        Base.display_error(err, catch_backtrace())
    end
end
