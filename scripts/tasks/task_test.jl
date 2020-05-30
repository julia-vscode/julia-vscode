using Pkg

Pkg.test(ARGS[1], coverage = true)

try
    import Coverage
catch
    exit()
end

coverage = Coverage.process_folder()

Coverage.LCOV.writefile("lcov.info", coverage)
