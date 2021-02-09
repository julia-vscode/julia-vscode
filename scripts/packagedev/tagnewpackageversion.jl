using Pkg

Pkg.instantiate()

using PkgDev

try
    version_arg = ARGS[3]
    new_version = nothing

    if version_arg=="Next"
        new_version = nothing
    elseif version_arg=="Major"
        new_version = :major
    elseif version_arg=="Minor"
        new_version = :minor
    elseif version_arg=="Patch"
        new_version = :patch
    else
        new_version = Base.VersionNumber(version_arg)
    end

    PkgDev.tag(PkgDev.FilePathsBase.cwd(), new_version, credentials=ARGS[1], github_username=ARGS[2])

catch err
    Base.display_error(err, catch_backtrace())
end

println("FINISHED")
readline()
