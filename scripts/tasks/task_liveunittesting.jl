pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeLiveUnitTesting
popfirst!(LOAD_PATH)

VSCodeLiveUnitTesting.live_unit_test(ARGS[1], ARGS[2])
