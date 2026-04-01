Test scripts for profiling VSCodeServer startup timings. Run with
```
julia --startup-file=no --project=. -i test_startup.jl --snoop --verbose
```

To check for method invalidations during loading:
```
julia --startup-file=no --project=. -i test_startup.jl --snoop-invalidations --verbose
```
