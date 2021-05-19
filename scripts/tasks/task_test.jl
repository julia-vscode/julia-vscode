path_to_test = ARGS[1]
delete_cov_files = ARGS[2]

package_name_to_run = basename(path_to_test)

using Pkg

Pkg.test(package_name_to_run, coverage=true)

empty!(Base.LOAD_PATH)
push!(Base.LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
push!(Base.LOAD_PATH, "@stdlib")

import CoverageTools

coverage = CoverageTools.process_folder()

CoverageTools.LCOV.writefile("lcov.info", coverage)

if delete_cov_files == "true"
    CoverageTools.clean_folder(path_to_test)
end
