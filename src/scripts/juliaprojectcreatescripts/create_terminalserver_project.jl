using Pkg

# updateDeps.ts refreshes the registry once up front, then creates the per-version environments in
# parallel. Without this, each of those concurrent children auto-updates the registry itself, and Pkg
# before ~1.13 does that unlocked: the `mv` onto General.tar.gz fails with EBUSY on Windows when
# another child has the tarball open.
Pkg.UPDATED_REGISTRY_THIS_SESSION[] = true

Pkg.add("Pkg")
Pkg.develop(PackageSpec(path="../../../packages/VSCodeServer"),)
