struct VSCodeTestSet <: Test.AbstractTestSet
    description::AbstractString
    results::Vector
    children::Vector
    VSCodeTestSet(desc) = new(desc, [], [])
end

function Test.record(ts::VSCodeTestSet, res)
    push!(ts.results, res)
end

function Test.record(ts::VSCodeTestSet, res::VSCodeTestSet)
    push!(ts.children, res)
end

function Test.finish(ts::VSCodeTestSet)
    if Test.get_testset_depth() != 0
        # Attach this test set to the parent test set
        parent_ts = Test.get_testset()
        Test.record(parent_ts, ts)
        return ts
    end
end
