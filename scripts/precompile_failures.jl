# Decides whether an error thrown while loading one of the extension's Julia
# apps (`using LanguageServer`, `using TestItemControllers`) means the app
# could not be precompiled or loaded on this machine: a package that failed to
# precompile, a broken depot, a cache file that cannot be opened, or a Julia
# installation that cannot spawn its own precompilation workers. These are
# conditions of the user's machine, not bugs, so the launchers turn them into
# an actionable message instead of a crash report.
function is_precompile_failure(err)
    if err isa ErrorException
        # "Error opening package file ..." comes from
        # `jl_restore_package_image_from_file`, which could not load a cache
        # file that is there: an application control policy or an antivirus
        # blocked it, it is corrupt, or the filesystem it sits on will not map
        # it. Julia reports that instead of falling back to recompiling, and
        # every one of those causes is the machine rather than this app.
        return startswith(err.msg, "Failed to precompile") ||
            occursin("failed to precompile", lowercase(err.msg)) ||
            startswith(err.msg, "Error opening package file")
    elseif err isa LoadError
        return is_precompile_failure(err.error)
    elseif err isa Base.SystemError
        # A failed file operation on the compiled cache (e.g. "opening file
        # '~/.julia/compiled/v1.x/JuliaWorkspaces/xyz.ji': Permission denied")
        # is a broken depot, not an app bug: the depot-permissions message
        # the caller shows is the actionable response, not a crash report.
        return occursin("compiled", err.prefix) || occursin(".ji", err.prefix)
    elseif err isa Base.IOError
        # During loading, the only processes Julia spawns are its own
        # precompilation workers, using the very binary that is running. A
        # spawn failure means the installation is broken or gone, e.g. an
        # environment manager replaced it mid-session.
        return startswith(err.msg, "could not spawn")
    elseif occursin("PkgPrecompileError", string(typeof(err)))
        return true
    else
        return occursin("failed to precompile", lowercase(sprint(showerror, err)))
    end
end

# Reported instead of the raw load error when the Julia installation itself is
# incomplete, so that the extension's telemetry sink can recognise the report by
# name and ask for a reinstall rather than filing a crash. Shared by both
# launchers; the sink tells them apart by cloud role.
struct JuliaInstallationIncomplete <: Exception
    msg::String
end

function Base.showerror(io::IO, ex::JuliaInstallationIncomplete)
    print(io, ex.msg)
end

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

# The two ways Julia (1.11 to 1.13) names a package whose source it cannot
# find, as `(regex, index of the name capture, index of the uuid capture)`:
# `require` throws the first; the parallel precompilation that `using` runs
# first on a fresh depot reports the second.
const MISSING_SOURCE_PATTERNS = [
    (Regex("Package (\\S+) \\[($UUID_PATTERN)\\] is required but does not seem to be installed"), 1, 2),
    (Regex("Missing source file for (?:Base\\.)?PkgId\\((?:Base\\.)?UUID\\(\"($UUID_PATTERN)\"\\), \"([^\"]+)\"\\)"), 2, 1),
]

# Returns the name of the standard library whose absence made loading fail, or
# `nothing` if the error is anything else.
#
# Julia reports a package whose source it cannot find with one of the messages
# in `MISSING_SOURCE_PATTERNS`. For a manifest entry with neither `path` nor
# `git-tree-sha1` the only place Julia looks is `Sys.STDLIB`, so if such an
# entry is missing there, the Julia installation is incomplete (an interrupted
# download or extraction, a pruned `share/julia/stdlib`): a condition of the
# user's machine. The same message for a package the extension bundles (a
# `path` entry) or pins from a registry (a `git-tree-sha1` entry) would be our
# packaging fault, so the shape of the manifest entry, not the message, is what
# decides.
#
# `Base.is_stdlib` cannot decide this: it answers by listing `Sys.STDLIB`, so
# it says `false` precisely for a stdlib that is missing from it. The manifest
# is read with Base's own TOML parser, as the `TOML` stdlib may be what is
# missing.
function missing_stdlib(err)
    try
        while err isa LoadError
            err = err.error
        end
        (err isa ArgumentError || is_precompile_failure(err)) || return nothing

        project_file = Base.active_project()
        project_file === nothing && return nothing
        manifest_file = Base.project_file_manifest_path(project_file)
        manifest_file === nothing && return nothing
        manifest_deps = get(Base.parsed_toml(manifest_file), "deps", nothing)
        manifest_deps isa Dict || return nothing

        function is_missing_stdlib(name, uuid)
            entries = get(manifest_deps, name, nothing)
            entries isa Vector || return false
            any(entries) do entry
                entry isa Dict &&
                    get(entry, "uuid", nothing) == uuid &&
                    !haskey(entry, "path") &&
                    !haskey(entry, "git-tree-sha1")
            end || return false
            return !isfile(joinpath(Sys.STDLIB, name, "src", name * ".jl"))
        end

        # A precompile failure can name several packages; the stdlib, if any,
        # is not necessarily the first.
        text = sprint(showerror, err)
        for (regex, name_index, uuid_index) in MISSING_SOURCE_PATTERNS
            for m in eachmatch(regex, text)
                name, uuid = String(m[name_index]), String(m[uuid_index])
                is_missing_stdlib(name, uuid) && return name
            end
        end
        return nothing
    catch
        # Classifying must never be what fails; an error that cannot be
        # classified is reported exactly as it was before.
        return nothing
    end
end
