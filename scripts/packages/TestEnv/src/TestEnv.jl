module TestEnv
using Pkg
using Pkg: PackageSpec
using Pkg.Types: Context, ensure_resolved, is_project_uuid, write_env, is_stdlib
using Pkg.Types: Types, projectfile_path, manifestfile_path
using Pkg.Operations: manifest_info, manifest_resolve!, project_deps_resolve!
using Pkg.Operations: project_rel_path, project_resolve!
using Pkg.Operations: sandbox, source_path, sandbox_preserve, abspath!
using Pkg.Operations: gen_target_project, isfixed


include("common.jl")
include("activate_do.jl")
include("activate_set.jl")

end
