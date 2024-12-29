using Pkg

Pkg.add("Unicode")
Pkg.add("Dates")
Pkg.add("Mmap")
Pkg.add("UUIDs")
Pkg.develop(PackageSpec(path="../../../packages/TestItemControllers"),)
