using Pkg

# See create_terminalserver_project.jl - the registry is already fresh, and concurrent updates from
# the parallel per-version environment creation race on Windows.
Pkg.UPDATED_REGISTRY_THIS_SESSION[] = true

Pkg.add("PkgDev")
